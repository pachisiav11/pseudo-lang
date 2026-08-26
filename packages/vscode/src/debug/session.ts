import {
  type ArrayValue,
  Cell,
  DEFAULT_RUN_OPTIONS,
  type Frame,
  Interpreter,
  type PValue,
  PseudoError,
  type Program,
  type Scope as PScope,
  SourceFile,
  type Stmt,
  assignable,
  coerceForStore,
  findField,
  inspectValue,
  lex,
  parseExpression,
  parseSource,
  renderAll,
  statementLines,
  typeName,
  typeOfValue,
  valueTypeName,
} from '@pseudo-lang/core';
import {
  Handles,
  InitializedEvent,
  LoggingDebugSession,
  OutputEvent,
  Scope as DapScope,
  Source,
  StackFrame,
  StoppedEvent,
  TerminatedEvent,
  Thread,
} from '@vscode/debugadapter';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ExtensionHost, HaltSignal } from '../host';

const THREAD_ID = 1;

export interface LaunchArguments extends DebugProtocol.LaunchRequestArguments {
  program: string;
  stopOnEntry?: boolean;
  strictDeclarations?: boolean;
  maxCallDepth?: number;
  randomFileRecordSize?: number;
}

type StepMode = 'none' | 'in' | 'over' | 'out';

type VarNode =
  | { k: 'scope'; scope: PScope; className?: string }
  | { k: 'array'; arr: ArrayValue }
  | { k: 'fields'; fields: Map<string, Cell>; className?: string }
  | { k: 'set'; members: PValue[] }
  | { k: 'pointer'; cell: Cell };

interface DebugFrame {
  name: string;
  line: number;
  scope: PScope;
}

export class PseudoDebugSession extends LoggingDebugSession {
  private interpreter: Interpreter | null = null;
  private sourceFile: SourceFile | null = null;
  private programPath = '';

  /** Lines that start a statement. A breakpoint may only sit on one of these. */
  private validLines: number[] = [];
  private readonly breakpoints = new Set<number>();

  private stepMode: StepMode = 'none';
  private stepBaseDepth = 0;
  private stopRequested = false;
  private stopOnEntry = false;
  private entered = false;

  private resume: (() => void) | null = null;
  private configured: (() => void) | null = null;
  private readonly configurationDone = new Promise<void>((done) => {
    this.configured = done;
  });

  // setBreakpoints needs the statement lines, which only exist once the
  // program has been parsed, and the client may send it before launch returns.
  private parsed: (() => void) | null = null;
  private readonly parseDone = new Promise<void>((done) => {
    this.parsed = done;
  });

  private pendingInput: ((line: string | null) => void) | null = null;
  private nextInputId = 1;

  private currentLine = 0;
  private frames: DebugFrame[] = [];
  private readonly handles = new Handles<VarNode>();

  constructor() {
    super();
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);
  }

  // ------------------------------------------------------------------ setup

  protected override initializeRequest(
    response: DebugProtocol.InitializeResponse,
    _args: DebugProtocol.InitializeRequestArguments,
  ): void {
    response.body = {
      ...response.body,
      supportsConfigurationDoneRequest: true,
      supportsSetVariable: true,
      supportsEvaluateForHovers: true,
      supportsTerminateRequest: true,
    };
    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
  }

  protected override configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    args: DebugProtocol.ConfigurationDoneArguments,
  ): void {
    super.configurationDoneRequest(response, args);
    this.configured?.();
  }

  protected override async launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: LaunchArguments,
  ): Promise<void> {
    this.programPath = args.program;
    this.stopOnEntry = args.stopOnEntry === true;

    let text: string;
    try {
      text = await readFile(args.program, 'utf8');
    } catch {
      this.sendEvent(new OutputEvent(`Cannot read ${args.program}\n`, 'stderr'));
      this.sendResponse(response);
      this.sendEvent(new TerminatedEvent());
      return;
    }

    const source = new SourceFile(args.program, text);
    this.sourceFile = source;
    const parsed = parseSource(source);

    if (parsed.program === null) {
      this.sendEvent(new OutputEvent(renderAll(parsed.errors, source), 'stderr'));
      this.parsed?.();
      this.sendResponse(response);
      this.sendEvent(new TerminatedEvent());
      return;
    }
    for (const warning of parsed.warnings) {
      this.sendEvent(new OutputEvent(renderAll([warning], source), 'console'));
    }

    this.validLines = [...statementLines(parsed.program.body)].sort((a, b) => a - b);
    this.parsed?.();
    this.sendResponse(response);

    await this.configurationDone;
    void this.execute(parsed.program, args);
  }

  private async execute(program: Program, args: LaunchArguments): Promise<void> {
    const host = new ExtensionHost(this.programPath, {
      write: (text) => {
        this.sendEvent(new OutputEvent(text, 'stdout'));
      },
      readLine: () => this.requestInput(),
      beforeStatement: (stmt, stack) => this.beforeStatement(stmt, stack),
    });

    const interpreter = new Interpreter(host, {
      ...DEFAULT_RUN_OPTIONS,
      strictDeclarations: args.strictDeclarations ?? false,
      maxCallDepth: args.maxCallDepth ?? DEFAULT_RUN_OPTIONS.maxCallDepth,
      randomFileRecordSize: args.randomFileRecordSize ?? DEFAULT_RUN_OPTIONS.randomFileRecordSize,
    });
    this.interpreter = interpreter;
    const source = this.sourceFile;

    try {
      await interpreter.run(program);
      const warnings = await interpreter.closeAll();
      if (source !== null) {
        for (const warning of warnings) {
          this.sendEvent(new OutputEvent(renderAll([warning], source), 'console'));
        }
      }
    } catch (err) {
      if (err instanceof HaltSignal) {
        await interpreter.closeAll();
      } else if (err instanceof PseudoError && source !== null) {
        await interpreter.closeAll();
        this.sendEvent(new OutputEvent(renderAll([err], source), 'stderr'));
      } else {
        this.sendEvent(new OutputEvent(`${String(err)}\n`, 'stderr'));
      }
    }
    this.sendEvent(new TerminatedEvent());
  }

  // --------------------------------------------------------------- stepping

  /**
   * The whole stepping engine. It parks the interpreter mid-program by simply
   * not resolving, which only works because execStmt awaits this before every
   * statement.
   */
  private async beforeStatement(stmt: Stmt, stack: readonly Frame[]): Promise<void> {
    if (this.stopRequested) throw new HaltSignal();

    const line = stmt.span.line;
    const depth = stack.length;
    const onEntry = this.stopOnEntry && !this.entered;
    this.entered = true;

    const atBreakpoint = this.breakpoints.has(line);
    const stepping =
      this.stepMode === 'in' ||
      (this.stepMode === 'over' && depth <= this.stepBaseDepth) ||
      (this.stepMode === 'out' && depth < this.stepBaseDepth);

    if (!onEntry && !atBreakpoint && !stepping) return;

    this.currentLine = line;
    this.snapshot(stack);
    this.stepMode = 'none';
    this.sendEvent(new StoppedEvent(atBreakpoint ? 'breakpoint' : 'step', THREAD_ID));

    await new Promise<void>((go) => {
      this.resume = go;
    });
    if (this.stopRequested) throw new HaltSignal();
  }

  /** Rebuilds the frame list, innermost first, for the panels to read. */
  private snapshot(stack: readonly Frame[]): void {
    const interpreter = this.interpreter;
    if (interpreter === null) return;
    this.handles.reset();

    const frames: DebugFrame[] = [];
    for (let j = stack.length - 1; j >= 0; j -= 1) {
      // A Frame records the line it was *called from*, so the line to show for
      // one frame is the call site recorded by the frame inside it.
      const line =
        j === stack.length - 1 ? this.currentLine : (stack[j + 1]?.line ?? this.currentLine);
      frames.push({
        name: stack[j]?.name ?? '?',
        line,
        scope: interpreter.scopesByFrame.get(j) ?? interpreter.globals,
      });
    }
    frames.push({
      name: '<main>',
      line: stack.length > 0 ? (stack[0]?.line ?? this.currentLine) : this.currentLine,
      scope: interpreter.globals,
    });
    this.frames = frames;
  }

  private go(mode: StepMode): void {
    this.stepMode = mode;
    this.stepBaseDepth = Math.max(0, this.frames.length - 1);
    const resume = this.resume;
    this.resume = null;
    resume?.();
  }

  protected override continueRequest(response: DebugProtocol.ContinueResponse): void {
    this.go('none');
    this.sendResponse(response);
  }

  protected override nextRequest(response: DebugProtocol.NextResponse): void {
    this.go('over');
    this.sendResponse(response);
  }

  protected override stepInRequest(response: DebugProtocol.StepInResponse): void {
    this.go('in');
    this.sendResponse(response);
  }

  protected override stepOutRequest(response: DebugProtocol.StepOutResponse): void {
    this.go('out');
    this.sendResponse(response);
  }

  protected override pauseRequest(response: DebugProtocol.PauseResponse): void {
    this.stepMode = 'in';
    this.sendResponse(response);
  }

  protected override disconnectRequest(response: DebugProtocol.DisconnectResponse): void {
    this.halt();
    this.sendResponse(response);
  }

  protected override terminateRequest(response: DebugProtocol.TerminateResponse): void {
    this.halt();
    this.sendResponse(response);
  }

  private halt(): void {
    this.stopRequested = true;
    const reply = this.pendingInput;
    this.pendingInput = null;
    reply?.(null);
    const resume = this.resume;
    this.resume = null;
    resume?.();
  }

  // ------------------------------------------------------------ breakpoints

  protected override async setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments,
  ): Promise<void> {
    await this.parseDone;
    this.breakpoints.clear();
    const source = new Source(basename(this.programPath), this.programPath);

    const breakpoints: DebugProtocol.Breakpoint[] = (args.breakpoints ?? []).map((requested) => {
      const line = this.snapLine(requested.line);
      if (line === null) {
        return { verified: false, line: requested.line, message: 'there is no statement here' };
      }
      this.breakpoints.add(line);
      return { verified: true, line, source };
    });

    response.body = { breakpoints };
    this.sendResponse(response);
  }

  /** A breakpoint on a blank line or a block end moves to the next statement. */
  private snapLine(line: number): number | null {
    for (const candidate of this.validLines) {
      if (candidate >= line) return candidate;
    }
    return null;
  }

  // ------------------------------------------------------------- inspection

  protected override threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = { threads: [new Thread(THREAD_ID, 'pseudocode')] };
    this.sendResponse(response);
  }

  protected override stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    _args: DebugProtocol.StackTraceArguments,
  ): void {
    const source = new Source(basename(this.programPath), this.programPath);
    response.body = {
      stackFrames: this.frames.map(
        (frame, index) => new StackFrame(index + 1, frame.name, source, frame.line),
      ),
      totalFrames: this.frames.length,
    };
    this.sendResponse(response);
  }

  protected override scopesRequest(
    response: DebugProtocol.ScopesResponse,
    args: DebugProtocol.ScopesArguments,
  ): void {
    const frame = this.frames[args.frameId - 1];
    const interpreter = this.interpreter;
    const scopes: DapScope[] = [];

    if (frame !== undefined && interpreter !== null) {
      if (frame.scope !== interpreter.globals) {
        scopes.push(
          new DapScope('Locals', this.handles.create({ k: 'scope', scope: frame.scope }), false),
        );
        const fields = this.objectScopeOf(frame.scope);
        if (fields !== null) {
          scopes.push(
            new DapScope(
              'Fields',
              this.handles.create({ k: 'scope', scope: fields, className: this.classOf(fields) }),
              false,
            ),
          );
        }
      }
      scopes.push(
        new DapScope(
          'Globals',
          this.handles.create({ k: 'scope', scope: interpreter.globals }),
          true,
        ),
      );
    }

    response.body = { scopes };
    this.sendResponse(response);
  }

  private objectScopeOf(scope: PScope): PScope | null {
    for (let s: PScope | null = scope; s !== null; s = s.parent) {
      if (s.kind === 'object') return s;
    }
    return null;
  }

  /** Which class an object scope belongs to, so PRIVATE fields can be marked. */
  private classOf(objectScope: PScope): string | undefined {
    const names = objectScope.entries().map(([name]) => name.toLowerCase());
    for (const cls of this.interpreter?.classes.values() ?? []) {
      const fields = [...cls.fields.keys()];
      if (fields.length > 0 && fields.every((field) => names.includes(field))) return cls.name;
    }
    return undefined;
  }

  protected override variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments,
  ): void {
    const node = this.handles.get(args.variablesReference);
    const children = node === undefined ? [] : this.childrenOf(node);
    const start = args.start ?? 0;
    const count = args.count === undefined || args.count === 0 ? children.length : args.count;

    response.body = {
      variables: children
        .slice(start, start + count)
        .map(([name, cell]) => this.variableFor(name, cell, node)),
    };
    this.sendResponse(response);
  }

  private childrenOf(node: VarNode): [string, Cell][] {
    switch (node.k) {
      case 'scope':
        return node.scope.entries();
      case 'array':
        return arrayChildren(node.arr);
      case 'fields':
        return [...node.fields.values()].map((cell) => [cell.name, cell] as [string, Cell]);
      case 'set':
        return node.members.map((member, index) => {
          const label = `[${index + 1}]`;
          return [label, new Cell(typeOfValue(member), member, label)] as [string, Cell];
        });
      case 'pointer':
        return [[node.cell.name, node.cell]];
    }
  }

  private variableFor(name: string, cell: Cell, parent?: VarNode): DebugProtocol.Variable {
    const value = cell.value;
    const variable: DebugProtocol.Variable = {
      name,
      value: inspectValue(value),
      type: typeName(cell.declared),
      variablesReference: 0,
    };

    const className =
      parent !== undefined && (parent.k === 'scope' || parent.k === 'fields')
        ? parent.className
        : undefined;
    if (className !== undefined) {
      const cls = this.interpreter?.classes.get(className.toLowerCase()) ?? null;
      if (findField(cls, name)?.field.access === 'PRIVATE') {
        variable.presentationHint = { visibility: 'private' };
      }
    }

    if (value === undefined) return variable;

    switch (value.t) {
      case 'ARRAY':
        variable.variablesReference = this.handles.create({ k: 'array', arr: value.arr });
        variable.indexedVariables = value.arr.cells.length;
        break;
      case 'RECORD':
        variable.variablesReference = this.handles.create({ k: 'fields', fields: value.fields });
        variable.namedVariables = value.fields.size;
        break;
      case 'OBJECT':
        variable.variablesReference = this.handles.create({
          k: 'fields',
          fields: value.obj.fields,
          className: value.obj.className,
        });
        variable.namedVariables = value.obj.fields.size;
        break;
      case 'SET':
        if (value.members.length > 0) {
          variable.variablesReference = this.handles.create({ k: 'set', members: value.members });
          variable.indexedVariables = value.members.length;
        }
        break;
      case 'POINTER':
        if (value.cell !== null) {
          variable.variablesReference = this.handles.create({ k: 'pointer', cell: value.cell });
          variable.namedVariables = 1;
        }
        break;
      default:
        break;
    }
    return variable;
  }

  protected override async setVariableRequest(
    response: DebugProtocol.SetVariableResponse,
    args: DebugProtocol.SetVariableArguments,
  ): Promise<void> {
    const node = this.handles.get(args.variablesReference);
    const cell =
      node === undefined
        ? undefined
        : this.childrenOf(node).find(([name]) => name === args.name)?.[1];

    if (cell === undefined) {
      this.sendErrorResponse(response, 2001, `\`${args.name}\` is not here`);
      return;
    }
    if (cell.isConstant) {
      this.sendErrorResponse(response, 2002, `\`${cell.name}\` is a CONSTANT`);
      return;
    }

    const value = await this.evaluateText(args.value, this.frames[0]?.scope);
    if (typeof value === 'string') {
      this.sendErrorResponse(response, 2003, value);
      return;
    }
    if (!assignable(cell.declared, value)) {
      this.sendErrorResponse(
        response,
        2004,
        `\`${cell.name}\` is ${typeName(cell.declared)}, so it cannot hold ${valueTypeName(value)}`,
      );
      return;
    }

    cell.value = coerceForStore(cell.declared, value);
    response.body = {
      value: inspectValue(cell.value),
      type: typeName(cell.declared),
      variablesReference: 0,
    };
    this.sendResponse(response);
  }

  protected override async evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments,
  ): Promise<void> {
    const frame = args.frameId === undefined ? this.frames[0] : this.frames[args.frameId - 1];

    // Hovering must never run the program's own code.
    if (args.context === 'hover' && looksLikeACall(args.expression)) {
      this.sendErrorResponse(response, 2005, 'a call is not evaluated in a hover');
      return;
    }

    const value = await this.evaluateText(args.expression, frame?.scope);
    if (typeof value === 'string') {
      this.sendErrorResponse(response, 2006, value);
      return;
    }

    const rendered = this.variableFor(
      args.expression,
      new Cell(typeOfValue(value), value, args.expression),
    );
    response.body = {
      result: rendered.value,
      type: rendered.type,
      variablesReference: rendered.variablesReference,
      indexedVariables: rendered.indexedVariables,
      namedVariables: rendered.namedVariables,
    };
    this.sendResponse(response);
  }

  /** Parses and evaluates one expression. Returns a message on failure. */
  private async evaluateText(text: string, scope: PScope | undefined): Promise<PValue | string> {
    const interpreter = this.interpreter;
    if (interpreter === null || scope === undefined) return 'the program is not running';

    const { tokens, sink } = lex(new SourceFile('<watch>', text));
    if (sink.hasErrors) return sink.errors[0]?.message ?? 'that cannot be read';

    const parsed = parseExpression(tokens);
    if (parsed.expr === null) return parsed.sink.errors[0]?.message ?? 'that cannot be read';

    try {
      return await interpreter.evaluate(parsed.expr, scope);
    } catch (err) {
      if (err instanceof PseudoError) return err.message;
      throw err;
    }
  }

  // ------------------------------------------------------------------ input

  /**
   * INPUT during a debug session has no terminal to read from, so the adapter
   * asks the extension to prompt and parks until the answer comes back.
   */
  private requestInput(): Promise<string | null> {
    const id = this.nextInputId;
    this.nextInputId += 1;
    return new Promise<string | null>((reply) => {
      this.pendingInput = reply;
      this.sendEvent({
        seq: 0,
        type: 'event',
        event: 'pseudoInputRequest',
        body: { id },
      } as DebugProtocol.Event);
    });
  }

  protected override customRequest(
    command: string,
    response: DebugProtocol.Response,
    args: { value?: string | null },
  ): void {
    if (command === 'pseudoInputResponse') {
      const reply = this.pendingInput;
      this.pendingInput = null;
      reply?.(args.value ?? null);
      this.sendResponse(response);
      return;
    }
    super.customRequest(command, response, args);
  }
}

function arrayChildren(arr: ArrayValue): [string, Cell][] {
  const out: [string, Cell][] = [];
  const first = arr.dims[0];
  const second = arr.dims[1];
  if (first === undefined) return out;

  if (second === undefined) {
    arr.cells.forEach((cell, index) => out.push([`[${first.lower + index}]`, cell]));
    return out;
  }

  const columns = second.upper - second.lower + 1;
  for (let row = first.lower; row <= first.upper; row += 1) {
    for (let column = second.lower; column <= second.upper; column += 1) {
      const cell = arr.cells[(row - first.lower) * columns + (column - second.lower)];
      if (cell !== undefined) out.push([`[${row},${column}]`, cell]);
    }
  }
  return out;
}

/** Cheap enough for its one job: keeping hovers free of side effects. */
function looksLikeACall(text: string): boolean {
  return /[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(text);
}

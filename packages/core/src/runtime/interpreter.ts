import type { DiagCode } from '../diagnostics/codes';
import { type DiagnosticInit, PseudoError, type Span, mergeSpans } from '../diagnostics/error';
import { type Frame, type Host, type RunOptions } from '../host';
import { isValidDate } from '../lexer/lexer';
import { type Expr, type FileMode, type LValue, type Program, type Stmt, type SubprogramDecl, type TypeDeclaration, type TypeRef, isLValue } from '../parser/ast';
import { Cell } from './cell';
import { callBuiltin, isBuiltin } from './builtins';
import {
  type OpenFile,
  type StoredRecord,
  decodeScalar,
  decodeSlot,
  encodeRecord,
  encodeSlot,
  growTo,
  isEmptySlot,
  slotBytes,
} from './files';
import { applyBinary, applyUnary } from './operators';
import { Scope } from './scope';
import { type Bound, type PType, elementCount, sameType, typeName } from './types';
import {
  type PValue,
  assignable,
  bool,
  char,
  coerceForStore,
  formatValue,
  int,
  isComposite,
  real,
  str,
  typeOfValue,
  valueTypeName,
} from './value';

export interface Subprogram {
  decl: SubprogramDecl;
  isFunction: boolean;
}

/** Carries a RETURN value out of a function body. */
export class ReturnSignal extends Error {
  constructor(
    readonly value: PValue | undefined,
    readonly span: Span,
  ) {
    super('RETURN');
    this.name = 'ReturnSignal';
  }
}

export class Interpreter {
  readonly globals = new Scope(null, 'global');
  readonly subprograms = new Map<string, Subprogram>();
  readonly typeDecls = new Map<string, TypeDeclaration>();
  /** Every enumerated value, so a bare `Spring` resolves without a prefix. */
  readonly enumMembers = new Map<string, { typeName: string; name: string; ordinal: number }>();
  private readonly resolvedTypes = new Map<string, PType>();
  readonly files = new Map<string, OpenFile>();
  private readonly frames: Frame[] = [];
  /** Local scopes by frame index, so the debugger can list them. */
  readonly scopesByFrame = new Map<number, Scope>();
  private nextScopeId = 1;

  constructor(
    readonly host: Host,
    readonly options: RunOptions,
  ) {}

  get callStack(): readonly Frame[] {
    return this.frames;
  }

  random(): number {
    return this.host.random();
  }

  // ------------------------------------------------------------------ entry

  async run(program: Program): Promise<void> {
    this.hoist(program.body);
    await this.execBlock(program.body, this.globals);
  }

  /**
   * Registers every subprogram before anything runs, so a procedure may call
   * one that is defined further down. The guide's DefaultSquare/Square example
   * depends on this.
   */
  private hoist(body: Stmt[]): void {
    for (const stmt of body) {
      if (stmt.kind === 'TypeDecl') {
        const key = stmt.decl.name.toLowerCase();
        if (this.typeDecls.has(key)) {
          throw this.error('E3003', stmt.decl.span, {
            message: `type \`${stmt.decl.name}\` is already defined`,
            label: 'defined twice',
          });
        }
        this.typeDecls.set(key, stmt.decl);
        if (stmt.decl.kind === 'Enum') {
          stmt.decl.values.forEach((value, ordinal) => {
            this.enumMembers.set(value.toLowerCase(), {
              typeName: (stmt.decl as { name: string }).name,
              name: value,
              ordinal,
            });
          });
        }
        continue;
      }

      if (stmt.kind === 'ProcDecl' || stmt.kind === 'FuncDecl') {
        const key = stmt.decl.name.toLowerCase();
        const existing = this.subprograms.get(key);
        if (existing !== undefined) {
          throw this.error('E3003', stmt.decl.span, {
            message: `\`${stmt.decl.name}\` is already defined on line ${existing.decl.span.line}`,
            label: 'defined twice',
          });
        }
        this.subprograms.set(key, { decl: stmt.decl, isFunction: stmt.kind === 'FuncDecl' });
      }
    }
  }

  async execBlock(body: Stmt[], scope: Scope): Promise<void> {
    for (const stmt of body) {
      await this.execStmt(stmt, scope);
    }
  }

  async execStmt(stmt: Stmt, scope: Scope): Promise<void> {
    // Every statement passes through the host so the debugger can park here.
    await this.host.beforeStatement(stmt, this.frames);

    switch (stmt.kind) {
      case 'Declare':
        return this.execDeclare(stmt, scope);
      case 'Constant':
        return this.execConstant(stmt, scope);
      case 'Assign':
        return this.execAssign(stmt, scope);
      case 'Output':
        return this.execOutput(stmt, scope);
      case 'Input':
        return this.execInput(stmt, scope);
      case 'If':
        return this.execIf(stmt, scope);
      case 'While':
        return this.execWhile(stmt, scope);
      case 'Repeat':
        return this.execRepeat(stmt, scope);
      case 'For':
        return this.execFor(stmt, scope);
      case 'Case':
        return this.execCase(stmt, scope);
      case 'ProcDecl':
      case 'FuncDecl':
        return; // registered by hoist(), nothing to do at run time
      case 'CallStmt':
        return this.execCallStmt(stmt, scope);
      case 'Return':
        return this.execReturn(stmt, scope);
      case 'TypeDecl':
        return; // registered by hoist()
      case 'Define':
        return this.execDefine(stmt, scope);
      case 'FileStmt':
        return this.execFileStmt(stmt, scope);
      default:
        throw this.error('E2002', stmt.span, {
          message: `\`${stmt.kind}\` is not supported yet`,
        });
    }
  }

  // ------------------------------------------------------------- statements

  private async execDeclare(
    stmt: Extract<Stmt, { kind: 'Declare' }>,
    scope: Scope,
  ): Promise<void> {
    if (scope.own(stmt.name) !== undefined) {
      throw this.error('E3003', stmt.span, {
        message: `\`${stmt.name}\` is already declared`,
        label: 'declared twice',
      });
    }
    const type = await this.resolveType(stmt.typeRef, scope);
    const cell = scope.define(stmt.name, type);
    // Arrays, records and pointers are structures, so DECLARE materialises
    // them. A scalar stays "declared but not yet assigned".
    cell.value = await this.makeValueFor(type, stmt.name, scope, stmt.span);
  }

  private async execConstant(
    stmt: Extract<Stmt, { kind: 'Constant' }>,
    scope: Scope,
  ): Promise<void> {
    if (scope.own(stmt.name) !== undefined) {
      throw this.error('E3003', stmt.span, {
        message: `\`${stmt.name}\` is already declared`,
        label: 'declared twice',
      });
    }
    const value = await this.evaluate(stmt.value, scope);
    const cell = scope.define(stmt.name, typeOfValue(value), true);
    cell.value = value;
  }

  private async execAssign(stmt: Extract<Stmt, { kind: 'Assign' }>, scope: Scope): Promise<void> {
    const value = await this.evaluate(stmt.value, scope);
    const cell = await this.resolveLValue(stmt.target, scope, value);
    this.store(cell, value, stmt.span);
  }

  store(cell: Cell, value: PValue, span: Span): void {
    if (cell.isConstant) {
      throw this.error('E3004', span, {
        message: `\`${cell.name}\` is a constant and cannot be changed`,
        label: 'constant',
      });
    }
    if (!assignable(cell.declared, value)) {
      throw this.error('E3012', span, {
        message: `cannot store ${valueTypeName(value)} in \`${cell.name}\`, which is ${typeName(cell.declared)}`,
        label: `this is ${valueTypeName(value)}`,
        help: this.assignmentHelp(cell.declared, value),
      });
    }
    cell.value = deepCopy(coerceForStore(cell.declared, value));
  }

  private assignmentHelp(declared: PType, value: PValue): string | undefined {
    if (declared.k === 'INTEGER' && value.t === 'REAL') {
      return 'A REAL is never truncated automatically. Use INT(x) to take the\nwhole part.';
    }
    if (declared.k === 'STRING' && value.t === 'CHAR') {
      return 'A CHAR uses single quotes and a STRING uses double quotes. Join it\nwith "" using & to make a STRING.';
    }
    if (declared.k === 'CHAR' && value.t === 'STRING') {
      return 'A CHAR holds exactly one character and uses single quotes.';
    }
    return undefined;
  }

  private async execOutput(stmt: Extract<Stmt, { kind: 'Output' }>, scope: Scope): Promise<void> {
    let line = '';
    for (const expr of stmt.values) {
      const value = await this.evaluate(expr, scope);
      if (isComposite(value) && value.t !== 'SET') {
        throw this.error('E3050', expr.span, {
          message: `OUTPUT cannot print a ${valueTypeName(value)}`,
          label: 'not a single value',
          help: 'Output the individual elements or fields instead.',
        });
      }
      line += formatValue(value);
    }
    await this.host.write(`${line}\n`);
  }

  private async execInput(stmt: Extract<Stmt, { kind: 'Input' }>, scope: Scope): Promise<void> {
    const line = await this.host.readLine();
    if (line === null) {
      throw this.error('E3052', stmt.span, {
        message: 'INPUT was reached but there is no more input',
        label: 'no input left',
      });
    }
    const placeholder = str(line);
    const cell = await this.resolveLValue(stmt.target, scope, placeholder);
    const value = this.convertInput(line, cell.declared, stmt.span, cell.name);
    this.store(cell, value, stmt.span);
  }

  private convertInput(line: string, declared: PType, span: Span, name: string): PValue {
    const text = line.trim();
    const bad = (want: string): PseudoError =>
      this.error('E3051', span, {
        message: `\`${line}\` is not ${want}, which is what \`${name}\` holds`,
        label: 'could not convert the input',
      });

    switch (declared.k) {
      case 'INTEGER':
        if (!/^[+-]?\d+$/.test(text)) throw bad('a whole number');
        return int(Number(text));
      case 'REAL':
        if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) throw bad('a number');
        return real(Number(text));
      case 'CHAR':
        if ([...text].length !== 1) throw bad('a single character');
        return char(text);
      case 'BOOLEAN': {
        const upper = text.toUpperCase();
        if (upper !== 'TRUE' && upper !== 'FALSE') throw bad('TRUE or FALSE');
        return bool(upper === 'TRUE');
      }
      case 'DATE': {
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
        if (m === null) throw bad('a date in the form dd/mm/yyyy');
        const value = { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) };
        if (!isValidDate(value)) throw bad('a valid calendar date');
        return { t: 'DATE', ...value };
      }
      case 'STRING':
        return str(line);
      default:
        throw this.error('E3051', span, {
          message: `INPUT cannot read a value of type ${typeName(declared)}`,
          label: 'not an input type',
        });
    }
  }

  private async execDefine(
    stmt: Extract<Stmt, { kind: 'Define' }>,
    scope: Scope,
  ): Promise<void> {
    const setType = await this.resolveType(
      { kind: 'NamedType', name: stmt.setType, span: stmt.span },
      scope,
    );
    if (setType.k !== 'SET') {
      throw this.error('E3061', stmt.span, {
        message: `\`${stmt.setType}\` is not a set type`,
        label: 'not a SET',
        help: `Declare it first:\nTYPE ${stmt.setType} = SET OF CHAR`,
      });
    }

    const members: PValue[] = [];
    for (const expr of stmt.values) {
      const value = await this.evaluate(expr, scope);
      if (!assignable(setType.base, value)) {
        throw this.error('E3096', expr.span, {
          message: `\`${stmt.setType}\` is a set of ${typeName(setType.base)}, but this member is ${valueTypeName(value)}`,
          label: `this is ${valueTypeName(value)}`,
        });
      }
      members.push(coerceForStore(setType.base, value));
    }

    const cell = scope.define(stmt.name, setType, true);
    cell.value = { t: 'SET', typeName: setType.name, members };
  }

  // ---------------------------------------------------------- file handling

  private async fileNameOf(expr: Expr, scope: Scope): Promise<string> {
    const value = await this.evaluate(expr, scope);
    if (value.t !== 'STRING') {
      throw this.error('E3111', expr.span, {
        message: `a file is identified by a STRING, but this is ${valueTypeName(value)}`,
        label: `this is ${valueTypeName(value)}`,
      });
    }
    return value.v;
  }

  private requireOpen(name: string, span: Span, mode?: FileMode): OpenFile {
    const file = this.files.get(name);
    if (file === undefined) {
      throw this.error('E3116', span, {
        message: `\`${name}\` is not open`,
        label: 'not open',
        help: `Open it first:\nOPENFILE "${name}" FOR ${mode ?? 'READ'}`,
      });
    }
    if (mode !== undefined && file.mode !== mode) {
      throw this.error(mode === 'READ' ? 'E3110' : 'E3116', span, {
        message: `\`${name}\` is open for ${file.mode}, not for ${mode}`,
        label: `open for ${file.mode}`,
        help: 'A file should be opened in only one mode at a time.',
      });
    }
    return file;
  }

  private async execFileStmt(
    stmt: Extract<Stmt, { kind: 'FileStmt' }>,
    scope: Scope,
  ): Promise<void> {
    const name = await this.fileNameOf(stmt.file, scope);

    switch (stmt.op) {
      case 'OPENFILE':
        return this.openFile(name, stmt.mode ?? 'READ', stmt.span);
      case 'CLOSEFILE': {
        if (!this.files.has(name)) {
          throw this.error('E3116', stmt.span, {
            message: `\`${name}\` is not open, so it cannot be closed`,
            label: 'not open',
          });
        }
        return this.closeFile(name);
      }
      case 'READFILE':
        return this.readFile(name, stmt, scope);
      case 'WRITEFILE':
        return this.writeFile(name, stmt, scope);
      case 'SEEK':
        return this.seek(name, stmt, scope);
      case 'GETRECORD':
        return this.getRecord(name, stmt, scope);
      case 'PUTRECORD':
        return this.putRecord(name, stmt, scope);
    }
  }

  private async openFile(name: string, mode: FileMode, span: Span): Promise<void> {
    const existing = this.files.get(name);
    if (existing !== undefined) {
      throw this.error('E3113', span, {
        message: `\`${name}\` is already open for ${existing.mode}`,
        label: 'already open',
        help: 'A file should be opened in only one mode at a time. Close it\nfirst with CLOSEFILE.',
      });
    }

    const path = this.host.resolvePath(name);
    const file: OpenFile = { name, path, mode };

    switch (mode) {
      case 'READ': {
        if (!(await this.host.fs.exists(path))) {
          throw this.error('E3112', span, {
            message: `there is no file called \`${name}\``,
            label: 'not found',
            help: 'Relative names are resolved against the folder holding the\npseudocode file.',
          });
        }
        file.lines = await this.host.fs.readFileLines(path);
        file.cursor = 0;
        break;
      }
      case 'WRITE':
        // The guide: "A new file will be created and any existing data in the
        // file will be lost." Truncating at open makes that true even if the
        // program never writes anything.
        await this.host.fs.writeFile(path, '', false);
        file.pending = [];
        break;
      case 'APPEND':
        file.pending = [];
        break;
      case 'RANDOM':
        file.buffer = (await this.host.fs.exists(path))
          ? await this.host.fs.readBinary(path)
          : new Uint8Array(0);
        break;
    }

    this.files.set(name, file);
  }

  async closeFile(name: string): Promise<void> {
    const file = this.files.get(name);
    if (file === undefined) return;
    this.files.delete(name);

    if (file.pending !== undefined) {
      await this.host.fs.writeFile(file.path, file.pending.join(''), true);
    }
    if (file.buffer !== undefined) {
      await this.host.fs.writeBinary(file.path, file.buffer);
    }
  }

  /** Flushes anything the program forgot to close, and warns about it. */
  async closeAll(): Promise<PseudoError[]> {
    const warnings: PseudoError[] = [];
    for (const name of [...this.files.keys()]) {
      warnings.push(
        new PseudoError('W1001', { line: 1, col: 1, endLine: 1, endCol: 2 }, {
          message: `\`${name}\` was still open when the program ended`,
          help: 'It has been closed and its data saved, but adding CLOSEFILE\nmakes the program correct.',
        }),
      );
      await this.closeFile(name);
    }
    return warnings;
  }

  fileAtEnd(name: string, span: Span): boolean {
    const file = this.requireOpen(name, span, 'READ');
    return (file.cursor ?? 0) >= (file.lines?.length ?? 0);
  }

  private async readFile(
    name: string,
    stmt: Extract<Stmt, { kind: 'FileStmt' }>,
    scope: Scope,
  ): Promise<void> {
    const file = this.requireOpen(name, stmt.span, 'READ');
    const target = stmt.target;
    if (target === undefined) return;

    const cell = await this.resolveLValue(target, scope, str(''));
    if (cell.declared.k !== 'STRING') {
      throw this.error('E3114', target.span, {
        message: `\`${cell.name}\` is ${typeName(cell.declared)}, but READFILE reads a line of text`,
        label: 'not a STRING',
      });
    }

    const cursor = file.cursor ?? 0;
    const line = file.lines?.[cursor];
    if (line === undefined) {
      throw this.error('E3115', stmt.span, {
        message: `there are no more lines to read from \`${name}\``,
        label: 'end of file',
        help: `Test for the end of the file first:\nWHILE NOT EOF("${name}")`,
      });
    }
    file.cursor = cursor + 1;
    this.store(cell, str(line), stmt.span);
  }

  private async writeFile(
    name: string,
    stmt: Extract<Stmt, { kind: 'FileStmt' }>,
    scope: Scope,
  ): Promise<void> {
    const file = this.files.get(name);
    if (file === undefined || file.pending === undefined) {
      throw this.error('E3116', stmt.span, {
        message:
          file === undefined
            ? `\`${name}\` is not open`
            : `\`${name}\` is open for ${file.mode}, not for writing`,
        label: 'cannot write',
        help: `Open it for writing first:\nOPENFILE "${name}" FOR WRITE`,
      });
    }
    if (stmt.value === undefined) return;
    const value = await this.evaluate(stmt.value, scope);
    if (isComposite(value) && value.t !== 'SET') {
      throw this.error('E3050', stmt.value.span, {
        message: `WRITEFILE cannot write a ${valueTypeName(value)}`,
        label: 'not a single value',
      });
    }
    file.pending.push(`${formatValue(value)}\n`);
  }

  private async seek(
    name: string,
    stmt: Extract<Stmt, { kind: 'FileStmt' }>,
    scope: Scope,
  ): Promise<void> {
    const file = this.requireOpen(name, stmt.span, 'RANDOM');
    if (stmt.value === undefined) return;
    const address = await this.wholeNumber(stmt.value, scope, 'a record address');
    if (address < 1) {
      throw this.error('E3082', stmt.value.span, {
        message: `record address ${address} is not valid`,
        label: 'addresses start at 1',
      });
    }
    file.recordPointer = address;
  }

  private async getRecord(
    name: string,
    stmt: Extract<Stmt, { kind: 'FileStmt' }>,
    scope: Scope,
  ): Promise<void> {
    const file = this.requireOpen(name, stmt.span, 'RANDOM');
    const pointer = file.recordPointer;
    if (pointer === undefined) {
      throw this.error('E3120', stmt.span, {
        message: `no record pointer has been set for \`${name}\``,
        label: 'no SEEK yet',
        help: `Move the pointer first:\nSEEK "${name}", 1`,
      });
    }
    const target = stmt.target;
    if (target === undefined) return;

    const cell = await this.resolveLValue(target, scope);
    if (cell.declared.k !== 'RECORD') {
      throw this.error('E3119', target.span, {
        message: `GETRECORD reads a record, but \`${cell.name}\` is ${typeName(cell.declared)}`,
        label: 'not a record',
      });
    }

    const size = this.options.randomFileRecordSize;
    const bytes = slotBytes(file.buffer ?? new Uint8Array(0), pointer, size);
    if (bytes === null || isEmptySlot(bytes)) {
      throw this.error('E3118', stmt.span, {
        message: `record ${pointer} of \`${name}\` is empty`,
        label: 'nothing stored there',
      });
    }

    const stored = JSON.parse(decodeSlot(bytes)) as StoredRecord;
    if (stored.__type.toLowerCase() !== cell.declared.name.toLowerCase()) {
      throw this.error('E3119', stmt.span, {
        message: `record ${pointer} holds a \`${stored.__type}\`, but \`${cell.name}\` is a \`${cell.declared.name}\``,
        label: 'wrong record type',
      });
    }

    const fresh = await this.makeValueFor(cell.declared, cell.name, scope, stmt.span);
    if (fresh === undefined || fresh.t !== 'RECORD') return;
    for (const field of fresh.fields.values()) {
      const raw = decodeScalar(stored.f[field.name]);
      if (raw === undefined) continue;
      field.value = coerceForStore(field.declared, narrowScalar(field.declared, raw));
    }
    cell.value = fresh;
  }

  private async putRecord(
    name: string,
    stmt: Extract<Stmt, { kind: 'FileStmt' }>,
    scope: Scope,
  ): Promise<void> {
    const file = this.requireOpen(name, stmt.span, 'RANDOM');
    const pointer = file.recordPointer;
    if (pointer === undefined) {
      throw this.error('E3120', stmt.span, {
        message: `no record pointer has been set for \`${name}\``,
        label: 'no SEEK yet',
        help: `Move the pointer first:\nSEEK "${name}", 1`,
      });
    }
    if (stmt.value === undefined) return;

    const value = await this.evaluate(stmt.value, scope);
    if (value.t !== 'RECORD') {
      throw this.error('E3119', stmt.value.span, {
        message: `PUTRECORD writes a record, but this is ${valueTypeName(value)}`,
        label: 'not a record',
      });
    }

    const size = this.options.randomFileRecordSize;
    const slot = encodeSlot(encodeRecord(value), size);
    if (slot === null) {
      throw this.error('E3117', stmt.span, {
        message: `a \`${value.typeName}\` does not fit in ${size} bytes`,
        label: 'record too large',
        help: 'Raise pseudoLang.randomFileRecordSize, or store less in the record.',
      });
    }

    file.buffer = growTo(file.buffer ?? new Uint8Array(0), pointer * size);
    file.buffer.set(slot, (pointer - 1) * size);
  }

  // ------------------------------------------------------------ subprograms

  private async execCallStmt(
    stmt: Extract<Stmt, { kind: 'CallStmt' }>,
    scope: Scope,
  ): Promise<void> {
    const target = this.subprograms.get(stmt.callee.toLowerCase());
    if (target === undefined) {
      throw this.error('E3092', stmt.span, {
        message: `there is no procedure called \`${stmt.callee}\``,
        label: 'not defined',
        help: isBuiltin(stmt.callee)
          ? `${stmt.callee.toUpperCase()} is a function, so use it inside an expression rather than with CALL.`
          : undefined,
      });
    }
    if (target.isFunction) {
      throw this.error('E2082', stmt.span, {
        message: `\`${target.decl.name}\` is a FUNCTION, so it cannot be called with CALL`,
        label: 'a function, not a procedure',
        help: 'A function returns a value, so it is used inside an expression:\nOUTPUT ' + target.decl.name + '(...)',
      });
    }
    await this.invoke(target, stmt.args, scope, stmt.span);
  }

  private async execReturn(
    stmt: Extract<Stmt, { kind: 'Return' }>,
    scope: Scope,
  ): Promise<void> {
    const value = stmt.value === undefined ? undefined : await this.evaluate(stmt.value, scope);
    throw new ReturnSignal(value, stmt.span);
  }

  /** Runs a procedure or function and returns its value, if it is a function. */
  async invoke(
    target: Subprogram,
    args: Expr[],
    callerScope: Scope,
    span: Span,
    receiver?: Scope,
  ): Promise<PValue | undefined> {
    const { decl, isFunction } = target;

    if (args.length !== decl.params.length) {
      throw this.error('E3093', span, {
        message: `\`${decl.name}\` takes ${decl.params.length} argument${decl.params.length === 1 ? '' : 's'}, but ${args.length} ${args.length === 1 ? 'was' : 'were'} given`,
        label: 'wrong number of arguments',
        help: `It is defined on line ${decl.span.line}.`,
      });
    }

    if (this.frames.length >= this.options.maxCallDepth) {
      throw this.error('E3020', span, {
        message: `\`${decl.name}\` has called itself more than ${this.options.maxCallDepth} times`,
        label: 'too deep',
        help: 'A recursive subprogram needs a case that stops the recursion.',
      });
    }

    const local = new Scope(receiver ?? this.globals, 'local');

    for (let i = 0; i < decl.params.length; i += 1) {
      const param = decl.params[i];
      const argExpr = args[i];
      if (param === undefined || argExpr === undefined) continue;
      const paramType = await this.resolveType(param.typeRef, callerScope);

      if (param.byRef) {
        if (!isLValue(argExpr)) {
          throw this.error('E3094', argExpr.span, {
            message: `\`${param.name}\` is a BYREF parameter, so it needs a variable rather than a value`,
            label: 'not a variable',
            help: 'Assign the value to a variable first, then pass that variable.',
          });
        }
        const cell = await this.resolveLValue(argExpr, callerScope);
        if (!sameType(cell.declared, paramType)) {
          throw this.error('E3096', argExpr.span, {
            message: `\`${param.name}\` is ${typeName(paramType)}, but \`${cell.name}\` is ${typeName(cell.declared)}`,
            label: `this is ${typeName(cell.declared)}`,
            help: 'A BYREF parameter must match the argument exactly, because they\nshare one storage location.',
          });
        }
        local.bind(param.name, cell);
        continue;
      }

      const value = await this.evaluate(argExpr, callerScope);
      if (!assignable(paramType, value)) {
        throw this.error('E3096', argExpr.span, {
          message: `\`${param.name}\` is ${typeName(paramType)}, but this argument is ${valueTypeName(value)}`,
          label: `this is ${valueTypeName(value)}`,
        });
      }
      const cell = local.define(param.name, paramType);
      cell.value = deepCopy(coerceForStore(paramType, value));
    }

    this.frames.push({ name: decl.name, line: span.line, scopeId: this.nextScopeId++ });
    this.scopesByFrame.set(this.frames.length - 1, local);

    try {
      await this.execBlock(decl.body, local);
      if (isFunction) {
        throw this.error('E3095', decl.span, {
          message: `\`${decl.name}\` finished without reaching a RETURN`,
          label: 'no RETURN was executed',
          help: 'Every path through a function must reach a RETURN statement.',
        });
      }
      return undefined;
    } catch (err) {
      if (err instanceof ReturnSignal) {
        if (!isFunction) {
          throw this.error('E2080', err.span, {
            message: `\`${decl.name}\` is a PROCEDURE, so it cannot RETURN a value`,
            label: 'RETURN inside a procedure',
            help: 'Only a FUNCTION returns a value. Use a BYREF parameter to send a\nresult back from a procedure.',
          });
        }
        if (err.value === undefined) {
          throw this.error('E3095', err.span, {
            message: `\`${decl.name}\` must RETURN a value`,
            label: 'no value given',
          });
        }
        const declared = await this.resolveType(
          decl.returns ?? { kind: 'PrimitiveType', name: 'INTEGER', span: decl.span },
          callerScope,
        );
        if (!assignable(declared, err.value)) {
          throw this.error('E3096', err.span, {
            message: `\`${decl.name}\` returns ${typeName(declared)}, but this value is ${valueTypeName(err.value)}`,
            label: `this is ${valueTypeName(err.value)}`,
          });
        }
        return coerceForStore(declared, err.value);
      }
      throw err;
    } finally {
      this.scopesByFrame.delete(this.frames.length - 1);
      this.frames.pop();
    }
  }

  // ----------------------------------------------------------- control flow

  private async condition(expr: Expr, scope: Scope, what: string): Promise<boolean> {
    const value = await this.evaluate(expr, scope);
    if (value.t !== 'BOOLEAN') {
      throw this.error('E3098', expr.span, {
        message: `the ${what} must be TRUE or FALSE, but this is ${valueTypeName(value)}`,
        label: `this is ${valueTypeName(value)}`,
      });
    }
    return value.v;
  }

  private async execIf(stmt: Extract<Stmt, { kind: 'If' }>, scope: Scope): Promise<void> {
    if (await this.condition(stmt.cond, scope, 'condition of an IF')) {
      await this.execBlock(stmt.then, scope);
    } else if (stmt.otherwise !== undefined) {
      await this.execBlock(stmt.otherwise, scope);
    }
  }

  private async execWhile(stmt: Extract<Stmt, { kind: 'While' }>, scope: Scope): Promise<void> {
    while (await this.condition(stmt.cond, scope, 'condition of a WHILE')) {
      await this.execBlock(stmt.body, scope);
    }
  }

  private async execRepeat(stmt: Extract<Stmt, { kind: 'Repeat' }>, scope: Scope): Promise<void> {
    for (;;) {
      await this.execBlock(stmt.body, scope);
      if (await this.condition(stmt.until, scope, 'condition of an UNTIL')) return;
    }
  }

  private async wholeNumber(expr: Expr, scope: Scope, what: string): Promise<number> {
    const value = await this.evaluate(expr, scope);
    if (value.t !== 'INTEGER') {
      throw this.error('E3030', expr.span, {
        message: `${what} must be a whole number, but this is ${valueTypeName(value)}`,
        label: `this is ${valueTypeName(value)}`,
      });
    }
    return value.v;
  }

  private async execFor(stmt: Extract<Stmt, { kind: 'For' }>, scope: Scope): Promise<void> {
    // The guide fixes no evaluation order, so all three are taken once, in
    // written order, before the loop starts.
    const from = await this.wholeNumber(stmt.from, scope, 'the start value of a FOR loop');
    const to = await this.wholeNumber(stmt.to, scope, 'the end value of a FOR loop');
    const step =
      stmt.step === undefined ? 1 : await this.wholeNumber(stmt.step, scope, 'a STEP value');

    if (step === 0) {
      throw this.error('E3031', stmt.step?.span ?? stmt.span, {
        message: 'STEP cannot be zero, because the loop would never end',
        label: 'zero step',
      });
    }

    let cell = scope.lookup(stmt.varName);
    if (cell === undefined) {
      if (this.options.strictDeclarations) {
        throw this.error('E3002', stmt.span, {
          message: `\`${stmt.varName}\` is not declared`,
          label: 'not declared',
          help: `Declare it first:\nDECLARE ${stmt.varName} : INTEGER`,
        });
      }
      cell = scope.define(stmt.varName, { k: 'INTEGER' });
    } else if (cell.declared.k !== 'INTEGER') {
      throw this.error('E3030', stmt.span, {
        message: `\`${cell.name}\` is ${typeName(cell.declared)}, but a FOR loop counts with an INTEGER`,
        label: 'not an INTEGER',
      });
    }

    let i = from;
    for (;;) {
      // Storing before the test leaves the counter holding the first value
      // that failed it, which is what a reader expects after the loop.
      cell.value = int(i);
      if (step > 0 ? i > to : i < to) return;
      await this.execBlock(stmt.body, scope);
      // Reading the counter back lets the body change it, which the guide
      // does not forbid.
      const current = cell.value;
      i = (current !== undefined && current.t === 'INTEGER' ? current.v : i) + step;
    }
  }

  private async execCase(stmt: Extract<Stmt, { kind: 'Case' }>, scope: Scope): Promise<void> {
    const selector = await this.evaluate(stmt.selector, scope);

    for (const clause of stmt.clauses) {
      this.requireConstantLabel(clause.from, scope);
      if (clause.to !== undefined) this.requireConstantLabel(clause.to, scope);

      const from = await this.evaluate(clause.from, scope);
      this.checkCaseLabel(selector, from, clause.from.span);

      if (clause.to === undefined) {
        const equal = applyBinary('EQ', selector, from, clause.from.span);
        if (equal.t === 'BOOLEAN' && equal.v) {
          await this.execBlock(clause.body, scope);
          return;
        }
        continue;
      }

      const to = await this.evaluate(clause.to, scope);
      this.checkCaseLabel(selector, to, clause.to.span);
      const atLeast = applyBinary('GTE', selector, from, clause.from.span);
      const atMost = applyBinary('LTE', selector, to, clause.to.span);
      if (atLeast.t === 'BOOLEAN' && atLeast.v && atMost.t === 'BOOLEAN' && atMost.v) {
        await this.execBlock(clause.body, scope);
        return;
      }
    }

    if (stmt.otherwise !== undefined) await this.execBlock(stmt.otherwise, scope);
  }

  /**
   * A named case label is only meaningful when it cannot change: a CONSTANT or
   * an enumerated value. A plain variable would make the CASE unreadable.
   */
  private requireConstantLabel(expr: Expr, scope: Scope): void {
    if (expr.kind !== 'Ident') return;
    if (this.enumMembers.has(expr.name.toLowerCase())) return;
    const cell = scope.lookup(expr.name);
    if (cell !== undefined && cell.isConstant) return;
    throw this.error('E2040', expr.span, {
      message: `\`${expr.name}\` cannot be a case label`,
      label: cell === undefined ? 'not defined' : 'a variable',
      help: 'A case label must be a literal, a CONSTANT, or a value of an\nenumerated type.',
    });
  }

  private checkCaseLabel(selector: PValue, label: PValue, span: Span): void {
    const numeric = (v: PValue): boolean => v.t === 'INTEGER' || v.t === 'REAL';
    if (numeric(selector) && numeric(label)) return;
    if (selector.t === label.t) return;
    const charString =
      (selector.t === 'STRING' && label.t === 'CHAR') ||
      (selector.t === 'CHAR' && label.t === 'STRING');
    throw this.error('E3040', span, {
      message: `this case is ${valueTypeName(label)} but the CASE selector is ${valueTypeName(selector)}`,
      label: `this is ${valueTypeName(label)}`,
      help: charString
        ? "CHAR and STRING are different types. A variable that is read with\nINPUT and never declared holds a STRING, so declare it as a CHAR\nfirst if you want to match single-quoted cases."
        : undefined,
    });
  }

  // ------------------------------------------------------------------ types

  async resolveType(ref: TypeRef, scope: Scope): Promise<PType> {
    switch (ref.kind) {
      case 'PrimitiveType':
        return { k: ref.name } as PType;
      case 'ArrayType': {
        const dims: Bound[] = [];
        for (const dim of ref.dims) {
          const lower = await this.wholeNumber(dim.lower, scope, 'an array bound');
          const upper = await this.wholeNumber(dim.upper, scope, 'an array bound');
          if (upper < lower) {
            throw this.error('E3082', mergeSpans(dim.lower.span, dim.upper.span), {
              message: `the upper bound ${upper} is below the lower bound ${lower}`,
              label: 'empty range',
            });
          }
          dims.push({ lower, upper });
        }
        return { k: 'ARRAY', dims, element: await this.resolveType(ref.element, scope) };
      }
      case 'NamedType': {
        const key = ref.name.toLowerCase();
        const memo = this.resolvedTypes.get(key);
        if (memo !== undefined) return memo;

        const decl = this.typeDecls.get(key);
        if (decl === undefined) {
          throw this.error('E3061', ref.span, {
            message: `unknown type \`${ref.name}\``,
            label: 'not a known type',
            help: 'Define it first with TYPE, or use one of INTEGER, REAL, CHAR,\nSTRING, BOOLEAN or DATE.',
          });
        }

        let resolved: PType;
        switch (decl.kind) {
          case 'Record':
            resolved = { k: 'RECORD', name: decl.name };
            break;
          case 'Enum':
            resolved = { k: 'ENUM', name: decl.name };
            break;
          case 'Pointer':
            resolved = {
              k: 'POINTER',
              name: decl.name,
              target: await this.resolveType(decl.target, scope),
            };
            break;
          case 'Set':
            resolved = {
              k: 'SET',
              name: decl.name,
              base: await this.resolveType(decl.base, scope),
            };
            break;
        }
        this.resolvedTypes.set(key, resolved);
        return resolved;
      }
    }
  }

  /** The declared field list of a record type, resolved on demand. */
  async recordFields(name: string, scope: Scope, span: Span): Promise<[string, PType][]> {
    const decl = this.typeDecls.get(name.toLowerCase());
    if (decl === undefined || decl.kind !== 'Record') {
      throw this.error('E3061', span, { message: `\`${name}\` is not a record type` });
    }
    const fields: [string, PType][] = [];
    for (const field of decl.fields) {
      fields.push([field.name, await this.resolveType(field.typeRef, scope)]);
    }
    return fields;
  }

  private async makeValueFor(type: PType, name: string, scope: Scope, span: Span): Promise<PValue | undefined> {
    if (type.k === 'ARRAY') {
      const value = makeArray(type, name);
      // An array of records needs each element materialised too, otherwise
      // `Form[Index].YearGroup <- 6` would have no field cell to write into.
      if (needsMaterialising(type.element)) {
        for (const cell of (value as Extract<PValue, { t: 'ARRAY' }>).arr.cells) {
          cell.value = await this.makeValueFor(type.element, cell.name, scope, span);
        }
      }
      return value;
    }
    if (type.k === 'RECORD') {
      const fields = new Map<string, Cell>();
      for (const [fieldName, fieldType] of await this.recordFields(type.name, scope, span)) {
        const cell = new Cell(fieldType, undefined, fieldName);
        cell.value = await this.makeValueFor(fieldType, fieldName, scope, span);
        fields.set(fieldName.toLowerCase(), cell);
      }
      return { t: 'RECORD', typeName: type.name, fields };
    }
    if (type.k === 'POINTER') {
      return { t: 'POINTER', typeName: type.name, target: type.target, cell: null };
    }
    return undefined;
  }

  // ------------------------------------------------------------ expressions

  async evaluate(expr: Expr, scope: Scope): Promise<PValue> {
    switch (expr.kind) {
      case 'IntLit':
        return int(expr.value);
      case 'RealLit':
        return real(expr.value);
      case 'StringLit':
        return str(expr.value);
      case 'CharLit':
        return char(expr.value);
      case 'BoolLit':
        return bool(expr.value);
      case 'DateLit':
        return { t: 'DATE', day: expr.day, month: expr.month, year: expr.year };

      case 'Ident': {
        const cell = scope.lookup(expr.name);
        if (cell === undefined) {
          const member = this.enumMembers.get(expr.name.toLowerCase());
          if (member !== undefined) {
            return {
              t: 'ENUM',
              typeName: member.typeName,
              name: member.name,
              ordinal: member.ordinal,
            };
          }
          throw this.error('E3001', expr.span, {
            message: `\`${expr.name}\` is used before it is given a value`,
            label: 'never assigned',
            help: 'Assign to it first, or declare it with DECLARE.',
          });
        }
        if (cell.value === undefined) {
          throw this.error('E3001', expr.span, {
            message: `\`${cell.name}\` is used before it is given a value`,
            label: 'declared but never assigned',
          });
        }
        return cell.value;
      }

      case 'Unary': {
        if (expr.op === 'ADDR') {
          if (!isLValue(expr.operand)) {
            throw this.error('E2050', expr.span, { label: 'not a variable' });
          }
          const cell = await this.resolveLValue(expr.operand, scope);
          // The pointer type name is filled in on assignment, when the
          // declared type of the destination is known.
          return { t: 'POINTER', typeName: '', target: cell.declared, cell };
        }
        const operand = await this.evaluate(expr.operand, scope);
        return applyUnary(expr.op, operand, expr.span);
      }

      case 'Member': {
        const cell = await this.memberCell(expr, scope);
        if (cell.value === undefined) {
          throw this.error('E3001', expr.span, {
            message: `\`${describeTarget(expr)}\` is used before it is given a value`,
            label: 'never assigned',
          });
        }
        return cell.value;
      }

      case 'Deref': {
        const cell = await this.derefCell(expr, scope);
        if (cell.value === undefined) {
          throw this.error('E3001', expr.span, {
            message: 'the value this pointer refers to has never been assigned',
            label: 'never assigned',
          });
        }
        return cell.value;
      }

      case 'Index': {
        const cell = await this.indexCell(expr, scope);
        if (cell.value === undefined) {
          throw this.error('E3001', expr.span, {
            message: `this element of \`${describeTarget(expr.target)}\` has never been given a value`,
            label: 'never assigned',
          });
        }
        return cell.value;
      }

      case 'Call': {
        if (isBuiltin(expr.callee) && !this.subprograms.has(expr.callee.toLowerCase())) {
          const args: PValue[] = [];
          for (const arg of expr.args) args.push(await this.evaluate(arg, scope));
          return callBuiltin(
            expr.callee,
            args,
            expr.args.map((a) => a.span),
            this,
            expr.span,
          );
        }

        const target = this.subprograms.get(expr.callee.toLowerCase());
        if (target === undefined) {
          throw this.error('E3090', expr.span, {
            message: `\`${expr.callee}\` is not a known function`,
            label: 'not defined',
            help: 'The 9618 guide defines RIGHT, LENGTH, MID, LCASE, UCASE, INT,\nRAND and EOF. An exam question defines any others it uses.',
          });
        }
        if (!target.isFunction) {
          throw this.error('E3105', expr.span, {
            message: `\`${target.decl.name}\` is a PROCEDURE, so it has no value to use here`,
            label: 'a procedure, not a function',
            help: `Call it as a statement instead:\nCALL ${target.decl.name}(...)`,
          });
        }
        const value = await this.invoke(target, expr.args, scope, expr.span);
        if (value === undefined) {
          throw this.error('E3095', expr.span, {
            message: `\`${target.decl.name}\` did not return a value`,
          });
        }
        return value;
      }

      case 'Binary': {
        const left = await this.evaluate(expr.left, scope);
        // AND and OR do not short-circuit in the guide, but evaluating the
        // right side only when it can change the answer never observably
        // differs, since pseudocode expressions have no side effects.
        const right = await this.evaluate(expr.right, scope);
        return applyBinary(expr.op, left, right, expr.span);
      }

      default:
        throw this.error('E3090', expr.span, {
          message: `\`${expr.kind}\` is not supported yet`,
        });
    }
  }

  // ----------------------------------------------------------------- arrays

  /** Shared by array reads and array writes. */
  private async indexCell(
    expr: Extract<Expr, { kind: 'Index' }>,
    scope: Scope,
  ): Promise<Cell> {
    const container = await this.evaluate(expr.target, scope);
    if (container.t !== 'ARRAY') {
      throw this.error('E3084', expr.target.span, {
        message: `\`${describeTarget(expr.target)}\` is ${valueTypeName(container)}, not an array`,
        label: 'not an array',
      });
    }

    const arr = container.arr;
    if (expr.indices.length !== arr.dims.length) {
      throw this.error('E3083', expr.span, {
        message: `this array has ${arr.dims.length} dimension${arr.dims.length === 1 ? '' : 's'}, but ${expr.indices.length} ${expr.indices.length === 1 ? 'index was' : 'indices were'} given`,
        label: 'wrong number of indices',
      });
    }

    let offset = 0;
    for (let d = 0; d < arr.dims.length; d += 1) {
      const dim = arr.dims[d];
      const indexExpr = expr.indices[d];
      if (dim === undefined || indexExpr === undefined) break;
      const index = await this.wholeNumber(indexExpr, scope, 'an array index');
      if (index < dim.lower || index > dim.upper) {
        throw this.error('E3082', indexExpr.span, {
          message: `array index ${index} is outside the bounds of \`${describeTarget(expr.target)}\``,
          label: `${index} is out of range`,
          help: `The valid range for this dimension is ${dim.lower} to ${dim.upper}.`,
        });
      }
      const size = dim.upper - dim.lower + 1;
      offset = offset * size + (index - dim.lower);
    }

    const cell = arr.cells[offset];
    if (cell === undefined) {
      throw this.error('E3082', expr.span, { message: 'array index out of bounds' });
    }
    return cell;
  }

  // ------------------------------------------------- records and pointers

  private async memberCell(
    expr: Extract<Expr, { kind: 'Member' }>,
    scope: Scope,
  ): Promise<Cell> {
    const container = await this.evaluate(expr.target, scope);

    if (container.t === 'RECORD') {
      const cell = container.fields.get(expr.field.toLowerCase());
      if (cell === undefined) {
        throw this.error('E3073', expr.span, {
          message: `\`${container.typeName}\` has no field called \`${expr.field}\``,
          label: 'unknown field',
          help: `Its fields are: ${[...container.fields.values()].map((c) => c.name).join(', ')}.`,
        });
      }
      return cell;
    }

    if (container.t === 'OBJECT') return this.objectFieldCell(container, expr, scope);

    throw this.error('E3072', expr.target.span, {
      message: `\`${describeTarget(expr.target)}\` is ${valueTypeName(container)}, so it has no fields`,
      label: 'not a record',
    });
  }

  /** Overridden in M8, when classes exist. */
  protected async objectFieldCell(
    _container: Extract<PValue, { t: 'OBJECT' }>,
    expr: Extract<Expr, { kind: 'Member' }>,
    _scope: Scope,
  ): Promise<Cell> {
    throw this.error('E3073', expr.span, { message: 'objects are not supported yet' });
  }

  private async derefCell(
    expr: Extract<Expr, { kind: 'Deref' }>,
    scope: Scope,
  ): Promise<Cell> {
    const pointer = await this.evaluate(expr.target, scope);
    if (pointer.t !== 'POINTER') {
      throw this.error('E3074', expr.target.span, {
        message: `\`${describeTarget(expr.target)}\` is ${valueTypeName(pointer)}, not a pointer`,
        label: 'not a pointer',
      });
    }
    if (pointer.cell === null) {
      throw this.error('E3070', expr.span, {
        message: `\`${describeTarget(expr.target)}\` does not point at anything yet`,
        label: 'no target',
        help: `Give it an address first, for example:\n${describeTarget(expr.target)} <- ^SomeVariable`,
      });
    }
    return pointer.cell;
  }

  // ---------------------------------------------------------------- lvalues

  /**
   * Resolves an assignment target to its Cell. `hint` types a variable that is
   * being created implicitly.
   */
  async resolveLValue(target: LValue, scope: Scope, hint?: PValue): Promise<Cell> {
    switch (target.kind) {
      case 'Ident': {
        const existing = scope.lookup(target.name);
        if (existing !== undefined) return existing;
        if (this.options.strictDeclarations || hint === undefined) {
          throw this.error('E3002', target.span, {
            message: `\`${target.name}\` is not declared`,
            label: 'not declared',
            help: 'Declare it first, for example:\nDECLARE ' + target.name + ' : INTEGER',
          });
        }
        return scope.define(target.name, typeOfValue(hint));
      }

      case 'Index':
        return this.indexCell(target, scope);
      case 'Member':
        return this.memberCell(target, scope);
      case 'Deref':
        return this.derefCell(target, scope);
    }
  }

  // ----------------------------------------------------------------- errors

  error(code: DiagCode, span: Span, init: DiagnosticInit = {}): PseudoError {
    const err = new PseudoError(code, span, init);
    err.callStack = this.frames
      .slice()
      .reverse()
      .map((f) => `${f.name} (line ${f.line})`);
    return err;
  }
}

/**
 * JSON has one number type and one string type, so a value read back from a
 * random file is re-tagged using the field's declared type.
 */
function narrowScalar(declared: PType, value: PValue): PValue {
  if (declared.k === 'INTEGER' && value.t === 'REAL') return int(Math.trunc(value.v));
  if (declared.k === 'CHAR' && value.t === 'STRING') return char(value.v);
  return value;
}

/** Types whose storage DECLARE creates up front rather than leaving unset. */
function needsMaterialising(type: PType): boolean {
  return type.k === 'ARRAY' || type.k === 'RECORD' || type.k === 'POINTER';
}

/** Builds the dense element list for a freshly declared array. */
export function makeArray(type: Extract<PType, { k: 'ARRAY' }>, name: string): PValue {
  const count = elementCount(type.dims);
  const cells: Cell[] = [];
  for (let i = 0; i < count; i += 1) {
    cells.push(new Cell(type.element, undefined, `${name}[${i}]`));
  }
  return { t: 'ARRAY', arr: { dims: type.dims, element: type.element, cells } };
}

/** A short readable form of an expression, for error messages. */
function describeTarget(expr: Expr): string {
  switch (expr.kind) {
    case 'Ident':
      return expr.name;
    case 'Member':
      return `${describeTarget(expr.target)}.${expr.field}`;
    case 'Index':
      return `${describeTarget(expr.target)}[...]`;
    case 'Deref':
      return `${describeTarget(expr.target)}^`;
    default:
      return 'this value';
  }
}

/**
 * Arrays and records assign by value (guide sections 3.2 and 4.2); everything
 * else is immutable or, for objects and pointers, deliberately by reference.
 */
export function deepCopy(value: PValue): PValue {
  switch (value.t) {
    case 'ARRAY':
      return {
        t: 'ARRAY',
        arr: {
          dims: value.arr.dims.map((d) => ({ ...d })),
          element: value.arr.element,
          cells: value.arr.cells.map(
            (c) => new Cell(c.declared, c.value === undefined ? undefined : deepCopy(c.value), c.name),
          ),
        },
      };
    case 'RECORD': {
      const fields = new Map<string, Cell>();
      for (const [key, cell] of value.fields) {
        fields.set(
          key,
          new Cell(cell.declared, cell.value === undefined ? undefined : deepCopy(cell.value), cell.name),
        );
      }
      return { t: 'RECORD', typeName: value.typeName, fields };
    }
    case 'SET':
      return { t: 'SET', typeName: value.typeName, members: value.members.map(deepCopy) };
    default:
      return value;
  }
}

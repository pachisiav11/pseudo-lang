import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { afterEach, describe, expect, it } from 'vitest';
import { PseudoDebugSession } from './session';

/**
 * Speaks the Debug Adapter Protocol to a real PseudoDebugSession over a pair of
 * in-memory streams. This is the whole adapter under test, not a stand-in.
 */
class Client {
  private seq = 1;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<number, (message: DebugProtocol.Response) => void>();
  private readonly events: DebugProtocol.Event[] = [];
  private readonly waiters: { event: string; resolve: (e: DebugProtocol.Event) => void }[] = [];

  private readonly toAdapter = new PassThrough();
  private readonly fromAdapter = new PassThrough();
  private readonly session = new PseudoDebugSession();

  constructor() {
    // Without this the adapter calls process.exit on shutdown, which would take
    // the test runner with it. The extension runs inline, where it is a no-op.
    this.session.setRunAsServer(true);
    this.session.start(this.toAdapter, this.fromAdapter);
    this.fromAdapter.on('data', (chunk: Buffer) => this.receive(chunk));
  }

  dispose(): void {
    this.toAdapter.destroy();
    this.fromAdapter.destroy();
  }

  send<T extends DebugProtocol.Response>(command: string, args: unknown = {}): Promise<T> {
    const request = { seq: this.seq, type: 'request', command, arguments: args };
    this.seq += 1;
    const body = JSON.stringify(request);
    return new Promise<T>((resolve) => {
      this.pending.set(request.seq, resolve as (m: DebugProtocol.Response) => void);
      this.toAdapter.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
    });
  }

  waitFor(event: string): Promise<DebugProtocol.Event> {
    const already = this.events.findIndex((e) => e.event === event);
    if (already >= 0) return Promise.resolve(this.events.splice(already, 1)[0] as DebugProtocol.Event);
    return new Promise((resolve) => this.waiters.push({ event, resolve }));
  }

  /** Everything the program has written to the debug console so far. */
  output(): string {
    return this.events
      .filter((e) => e.event === 'output')
      .map((e) => (e.body as DebugProtocol.OutputEvent['body']).output)
      .join('');
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const header = this.buffer.indexOf('\r\n\r\n');
      if (header < 0) return;
      const length = Number(/Content-Length: (\d+)/.exec(this.buffer.toString('utf8', 0, header))?.[1]);
      const start = header + 4;
      if (this.buffer.length < start + length) return;
      const message = JSON.parse(this.buffer.toString('utf8', start, start + length));
      this.buffer = this.buffer.subarray(start + length);
      this.dispatch(message);
    }
  }

  private dispatch(message: DebugProtocol.ProtocolMessage): void {
    if (message.type === 'response') {
      const response = message as DebugProtocol.Response;
      const resolve = this.pending.get(response.request_seq);
      this.pending.delete(response.request_seq);
      resolve?.(response);
      return;
    }
    const event = message as DebugProtocol.Event;
    const index = this.waiters.findIndex((w) => w.event === event.event);
    if (index >= 0) {
      const [waiter] = this.waiters.splice(index, 1);
      waiter?.resolve(event);
      if (event.event === 'output') this.events.push(event);
      return;
    }
    this.events.push(event);
  }
}

const folder = mkdtempSync(join(tmpdir(), 'pseudo-debug-'));

function programFile(name: string, text: string): string {
  const path = join(folder, name);
  writeFileSync(path, text, 'utf8');
  return path;
}

let client: Client | null = null;

afterEach(() => {
  client?.dispose();
  client = null;
});

/** initialize, launch, set breakpoints, configurationDone. */
async function launch(program: string, breakpoints: number[], stopOnEntry = false): Promise<Client> {
  const c = new Client();
  client = c;
  await c.send('initialize', { adapterID: 'pseudo', linesStartAt1: true, columnsStartAt1: true });
  await c.send('launch', { program, stopOnEntry });
  await c.send('setBreakpoints', {
    source: { path: program },
    breakpoints: breakpoints.map((line) => ({ line })),
  });
  await c.send('configurationDone');
  return c;
}

interface Snapshot {
  line: number;
  frames: string[];
  variables: Record<string, string>;
}

/** Reads the panels the way the UI does: stackTrace, then scopes, then variables. */
async function inspect(c: Client, scopeName = 'Locals'): Promise<Snapshot> {
  const stack = await c.send<DebugProtocol.StackTraceResponse>('stackTrace', { threadId: 1 });
  const top = stack.body.stackFrames[0];
  const scopes = await c.send<DebugProtocol.ScopesResponse>('scopes', { frameId: top?.id ?? 1 });
  const wanted =
    scopes.body.scopes.find((s) => s.name === scopeName) ?? scopes.body.scopes[0];
  const variables = await c.send<DebugProtocol.VariablesResponse>('variables', {
    variablesReference: wanted?.variablesReference ?? 0,
  });
  return {
    line: top?.line ?? 0,
    frames: stack.body.stackFrames.map((f) => f.name),
    variables: Object.fromEntries(variables.body.variables.map((v) => [v.name, v.value])),
  };
}

const COUNTING = programFile(
  'counting.pseudo',
  ['DECLARE Total : INTEGER', 'Total <- 0', 'Total <- Total + 5', 'Total <- Total * 2', 'OUTPUT Total', ''].join('\n'),
);

describe('breakpoints and stepping', () => {
  it('stops at a breakpoint with the values so far', async () => {
    const c = await launch(COUNTING, [3]);
    await c.waitFor('stopped');

    const stopped = await inspect(c, 'Globals');
    expect(stopped.line).toBe(3);
    expect(stopped.variables.Total).toBe('0');
    expect(stopped.frames).toEqual(['<main>']);
  });

  it('advances exactly one line on step over', async () => {
    const c = await launch(COUNTING, [3]);
    await c.waitFor('stopped');

    await c.send('next', { threadId: 1 });
    await c.waitFor('stopped');

    const stepped = await inspect(c, 'Globals');
    expect(stepped.line).toBe(4);
    expect(stepped.variables.Total).toBe('5');
  });

  it('runs to the end on continue', async () => {
    const c = await launch(COUNTING, [3]);
    await c.waitFor('stopped');

    await c.send('continue', { threadId: 1 });
    await c.waitFor('terminated');
    expect(c.output()).toContain('10');
  });

  it('reports one thread', async () => {
    const c = await launch(COUNTING, [3]);
    await c.waitFor('stopped');
    const threads = await c.send<DebugProtocol.ThreadsResponse>('threads');
    expect(threads.body.threads).toEqual([{ id: 1, name: 'pseudocode' }]);
  });

  it('moves a breakpoint on a blank line down to the next statement', async () => {
    const spaced = programFile(
      'spaced.pseudo',
      ['DECLARE X : INTEGER', '', '', 'X <- 1', 'OUTPUT X', ''].join('\n'),
    );
    const c = await launch(spaced, [2]);
    await c.waitFor('stopped');
    expect((await inspect(c, 'Globals')).line).toBe(4);
  });

  it('stops on the first statement when asked to', async () => {
    const c = await launch(COUNTING, [], true);
    await c.waitFor('stopped');
    expect((await inspect(c, 'Globals')).line).toBe(1);
  });
});

const RECURSION = programFile(
  'recursion.pseudo',
  [
    'FUNCTION Factorial(N : INTEGER) RETURNS INTEGER',
    '   IF N <= 1 THEN',
    '      RETURN 1',
    '   ENDIF',
    '   RETURN N * Factorial(N - 1)',
    'ENDFUNCTION',
    '',
    'OUTPUT Factorial(3)',
    '',
  ].join('\n'),
);

describe('the call stack', () => {
  it('shows one frame per active call, innermost first', async () => {
    const c = await launch(RECURSION, [3]);
    await c.waitFor('stopped');

    const stopped = await inspect(c);
    expect(stopped.line).toBe(3);
    expect(stopped.frames).toEqual(['Factorial', 'Factorial', 'Factorial', '<main>']);
    expect(stopped.variables.N).toBe('1');
  });

  it('shows each frame its own locals', async () => {
    const c = await launch(RECURSION, [3]);
    await c.waitFor('stopped');

    const stack = await c.send<DebugProtocol.StackTraceResponse>('stackTrace', { threadId: 1 });
    const outer = stack.body.stackFrames[2];
    const scopes = await c.send<DebugProtocol.ScopesResponse>('scopes', { frameId: outer?.id ?? 0 });
    const locals = scopes.body.scopes.find((s) => s.name === 'Locals');
    const variables = await c.send<DebugProtocol.VariablesResponse>('variables', {
      variablesReference: locals?.variablesReference ?? 0,
    });
    expect(variables.body.variables.find((v) => v.name === 'N')?.value).toBe('3');
  });

  it('lands in the caller on step out', async () => {
    const nested = programFile(
      'nested.pseudo',
      [
        'PROCEDURE Inner()',
        '   OUTPUT "inner"',
        'ENDPROCEDURE',
        '',
        'PROCEDURE Outer()',
        '   CALL Inner()',
        '   OUTPUT "outer"',
        'ENDPROCEDURE',
        '',
        'CALL Outer()',
        'OUTPUT "done"',
        '',
      ].join('\n'),
    );
    const c = await launch(nested, [2]);
    await c.waitFor('stopped');
    expect((await inspect(c)).frames).toEqual(['Inner', 'Outer', '<main>']);

    await c.send('stepOut', { threadId: 1 });
    await c.waitFor('stopped');

    const back = await inspect(c);
    expect(back.frames).toEqual(['Outer', '<main>']);
    expect(back.line).toBe(7);
  });

  it('steps into a call rather than over it', async () => {
    const nested = programFile(
      'stepin.pseudo',
      [
        'PROCEDURE Greet()',
        '   OUTPUT "hello"',
        'ENDPROCEDURE',
        '',
        'CALL Greet()',
        'OUTPUT "done"',
        '',
      ].join('\n'),
    );
    const c = await launch(nested, [5]);
    await c.waitFor('stopped');

    await c.send('stepIn', { threadId: 1 });
    await c.waitFor('stopped');

    const inside = await inspect(c);
    expect(inside.frames).toEqual(['Greet', '<main>']);
    expect(inside.line).toBe(2);
  });

  it('steps over a call without stopping inside it', async () => {
    const nested = programFile(
      'stepover.pseudo',
      [
        'PROCEDURE Greet()',
        '   OUTPUT "hello"',
        'ENDPROCEDURE',
        '',
        'CALL Greet()',
        'OUTPUT "done"',
        '',
      ].join('\n'),
    );
    const c = await launch(nested, [5]);
    await c.waitFor('stopped');

    await c.send('next', { threadId: 1 });
    await c.waitFor('stopped');

    const after = await inspect(c, 'Globals');
    expect(after.frames).toEqual(['<main>']);
    expect(after.line).toBe(6);
  });

  it('runs to the end when step out has nowhere left to land', async () => {
    const c = await launch(RECURSION, [3]);
    await c.waitFor('stopped');

    await c.send('stepOut', { threadId: 1 });
    await c.waitFor('terminated');
    expect(c.output()).toContain('6');
  });
});

describe('the variables panel', () => {
  it('expands an array, naming elements by their declared index', async () => {
    const program = programFile(
      'array.pseudo',
      [
        'DECLARE Marks : ARRAY[1:3] OF INTEGER',
        'Marks[1] <- 10',
        'Marks[2] <- 20',
        'Marks[3] <- 30',
        'OUTPUT Marks[1]',
        '',
      ].join('\n'),
    );
    const c = await launch(program, [5]);
    await c.waitFor('stopped');

    const scopes = await c.send<DebugProtocol.ScopesResponse>('scopes', { frameId: 1 });
    const globals = scopes.body.scopes.find((s) => s.name === 'Globals');
    const top = await c.send<DebugProtocol.VariablesResponse>('variables', {
      variablesReference: globals?.variablesReference ?? 0,
    });
    const marks = top.body.variables.find((v) => v.name === 'Marks');
    expect(marks?.value).toBe('ARRAY[1:3] OF INTEGER');
    expect(marks?.variablesReference).toBeGreaterThan(0);

    const elements = await c.send<DebugProtocol.VariablesResponse>('variables', {
      variablesReference: marks?.variablesReference ?? 0,
    });
    expect(elements.body.variables.map((v) => [v.name, v.value])).toEqual([
      ['[1]', '10'],
      ['[2]', '20'],
      ['[3]', '30'],
    ]);
  });

  it('names the elements of a two-dimensional array by row and column', async () => {
    const program = programFile(
      'grid.pseudo',
      [
        'DECLARE Grid : ARRAY[1:2,1:2] OF INTEGER',
        'Grid[1,1] <- 1',
        'Grid[1,2] <- 2',
        'Grid[2,1] <- 3',
        'Grid[2,2] <- 4',
        'OUTPUT Grid[1,1]',
        '',
      ].join('\n'),
    );
    const c = await launch(program, [6]);
    await c.waitFor('stopped');

    const scopes = await c.send<DebugProtocol.ScopesResponse>('scopes', { frameId: 1 });
    const globals = scopes.body.scopes.find((s) => s.name === 'Globals');
    const top = await c.send<DebugProtocol.VariablesResponse>('variables', {
      variablesReference: globals?.variablesReference ?? 0,
    });
    const grid = top.body.variables.find((v) => v.name === 'Grid');
    const elements = await c.send<DebugProtocol.VariablesResponse>('variables', {
      variablesReference: grid?.variablesReference ?? 0,
    });
    expect(elements.body.variables.map((v) => [v.name, v.value])).toEqual([
      ['[1,1]', '1'],
      ['[1,2]', '2'],
      ['[2,1]', '3'],
      ['[2,2]', '4'],
    ]);
  });

  it('renders every scalar the way the guide prints it', async () => {
    const program = programFile(
      'scalars.pseudo',
      [
        'DECLARE Count : INTEGER',
        'DECLARE Ratio : REAL',
        'DECLARE Letter : CHAR',
        'DECLARE Word : STRING',
        'DECLARE Flag : BOOLEAN',
        'DECLARE Day : DATE',
        'DECLARE Empty : INTEGER',
        'Count <- 42',
        'Ratio <- 4.0',
        "Letter <- 'x'",
        'Word <- "hi"',
        'Flag <- TRUE',
        'Day <- 02/01/2005',
        'OUTPUT Count',
        '',
      ].join('\n'),
    );
    const c = await launch(program, [14]);
    await c.waitFor('stopped');

    expect((await inspect(c, 'Globals')).variables).toEqual({
      Count: '42',
      Ratio: '4.0',
      Letter: "'x'",
      Word: '"hi"',
      Flag: 'TRUE',
      Day: '02/01/2005',
      Empty: '<no value>',
    });
  });

  it('expands a record and marks an object field PRIVATE', async () => {
    const program = programFile(
      'objects.pseudo',
      [
        'TYPE Student',
        '   DECLARE Name : STRING',
        '   DECLARE Mark : INTEGER',
        'ENDTYPE',
        '',
        'CLASS Pet',
        '   PRIVATE Nickname : STRING',
        '   PUBLIC PROCEDURE NEW(Given : STRING)',
        '      Nickname <- Given',
        '   ENDPROCEDURE',
        'ENDCLASS',
        '',
        'DECLARE Pupil : Student',
        'DECLARE Tiddles : Pet',
        'Pupil.Name <- "Ada"',
        'Pupil.Mark <- 91',
        'Tiddles <- NEW Pet("Tiddles")',
        'OUTPUT Pupil.Name',
        '',
      ].join('\n'),
    );
    const c = await launch(program, [18]);
    await c.waitFor('stopped');

    const scopes = await c.send<DebugProtocol.ScopesResponse>('scopes', { frameId: 1 });
    const globals = scopes.body.scopes.find((s) => s.name === 'Globals');
    const top = await c.send<DebugProtocol.VariablesResponse>('variables', {
      variablesReference: globals?.variablesReference ?? 0,
    });

    const pupil = top.body.variables.find((v) => v.name === 'Pupil');
    expect(pupil?.value).toBe('Student');
    const fields = await c.send<DebugProtocol.VariablesResponse>('variables', {
      variablesReference: pupil?.variablesReference ?? 0,
    });
    expect(fields.body.variables.map((v) => [v.name, v.value])).toEqual([
      ['Name', '"Ada"'],
      ['Mark', '91'],
    ]);

    const pet = top.body.variables.find((v) => v.name === 'Tiddles');
    expect(pet?.value).toBe('Pet');
    const petFields = await c.send<DebugProtocol.VariablesResponse>('variables', {
      variablesReference: pet?.variablesReference ?? 0,
    });
    expect(petFields.body.variables[0]?.presentationHint?.visibility).toBe('private');
  });

  it('edits a scalar and rejects a value of the wrong type', async () => {
    const c = await launch(COUNTING, [3]);
    await c.waitFor('stopped');

    const scopes = await c.send<DebugProtocol.ScopesResponse>('scopes', { frameId: 1 });
    const reference = scopes.body.scopes.find((s) => s.name === 'Globals')?.variablesReference ?? 0;

    const ok = await c.send<DebugProtocol.SetVariableResponse>('setVariable', {
      variablesReference: reference,
      name: 'Total',
      value: '100',
    });
    expect(ok.success).toBe(true);
    expect(ok.body.value).toBe('100');

    const bad = await c.send<DebugProtocol.SetVariableResponse>('setVariable', {
      variablesReference: reference,
      name: 'Total',
      value: '"text"',
    });
    expect(bad.success).toBe(false);

    await c.send('continue', { threadId: 1 });
    await c.waitFor('terminated');
    expect(c.output()).toContain('210');
  });
});

describe('watch and hover', () => {
  it('evaluates an expression against the stopped frame', async () => {
    const c = await launch(COUNTING, [4]);
    await c.waitFor('stopped');

    const watch = await c.send<DebugProtocol.EvaluateResponse>('evaluate', {
      expression: 'Total * 3',
      frameId: 1,
      context: 'watch',
    });
    expect(watch.body.result).toBe('15');
  });

  it('refuses to run a call while hovering', async () => {
    const c = await launch(RECURSION, [3]);
    await c.waitFor('stopped');

    const hover = await c.send<DebugProtocol.EvaluateResponse>('evaluate', {
      expression: 'Factorial(5)',
      frameId: 1,
      context: 'hover',
    });
    expect(hover.success).toBe(false);
  });

  it('reports an expression it cannot read rather than failing the session', async () => {
    const c = await launch(COUNTING, [3]);
    await c.waitFor('stopped');

    const watch = await c.send<DebugProtocol.EvaluateResponse>('evaluate', {
      expression: 'Total +',
      frameId: 1,
      context: 'watch',
    });
    expect(watch.success).toBe(false);
  });
});

describe('input during a debug session', () => {
  it('asks for a line and carries on with the answer', async () => {
    const program = programFile(
      'ask.pseudo',
      ['DECLARE Name : STRING', 'INPUT Name', 'OUTPUT "Hello, ", Name', ''].join('\n'),
    );
    const c = await launch(program, []);

    await c.waitFor('pseudoInputRequest');
    await c.send('pseudoInputResponse', { value: 'Ada' });

    await c.waitFor('terminated');
    expect(c.output()).toContain('Hello, Ada');
  });
});

describe('a program that will not parse', () => {
  it('reports the diagnostic and terminates instead of starting', async () => {
    const program = programFile('broken.pseudo', 'Total = 0\n');
    const c = new Client();
    client = c;
    await c.send('initialize', { adapterID: 'pseudo' });
    const terminated = c.waitFor('terminated');
    await c.send('launch', { program });
    await terminated;
    expect(c.output()).toContain('E2001');
  });
});

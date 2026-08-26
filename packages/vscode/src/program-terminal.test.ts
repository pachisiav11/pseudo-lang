import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProgramRunner } from './program-terminal';

const folder = mkdtempSync(join(tmpdir(), 'pseudo-run-'));

function programFile(name: string, lines: string[]): string {
  const path = join(folder, name);
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

/** Drives a ProgramRunner and collects everything it writes to the terminal. */
class Session {
  private readonly chunks: string[] = [];
  readonly runner: ProgramRunner;
  readonly finished: Promise<void>;

  constructor(path: string) {
    this.runner = new ProgramRunner(path, readFileSync(path, 'utf8'), {}, (text) => {
      this.chunks.push(text);
    });
    this.finished = this.runner.run();
  }

  /** The raw stream, escape codes and all. */
  get raw(): string {
    return this.chunks.join('');
  }

  /** What a reader would see: no colours, no carriage returns. */
  get text(): string {
    // eslint-disable-next-line no-control-regex
    return this.raw.replace(/\x1b\[\d+m/g, '').replace(/\r\n/g, '\n');
  }

  type(data: string): void {
    this.runner.handleInput(data);
  }

  /** Lets the interpreter get as far as it can before the next assertion. */
  settle(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }
}

const GREETING = programFile('greeting.pseudo', [
  'DECLARE Name : STRING',
  'OUTPUT "What is your name? "',
  'INPUT Name',
  'OUTPUT "Hello, ", Name, "!"',
]);

describe('running a program in the terminal', () => {
  it('writes the output and says it finished', async () => {
    const s = new Session(programFile('sum.pseudo', ['OUTPUT 2 + 2']));
    await s.finished;
    expect(s.text).toBe('4\n\n[Finished]\n');
  });

  it('turns a bare newline into a carriage return and newline', async () => {
    const s = new Session(programFile('two.pseudo', ['OUTPUT "one"', 'OUTPUT "two"']));
    await s.finished;
    // Without this every line after the first starts where the last one ended.
    expect(s.raw).toContain('one\r\ntwo\r\n');
    expect(s.raw).not.toMatch(/[^\r]\n/);
  });

  it('reads a typed line into INPUT', async () => {
    const s = new Session(GREETING);
    await s.settle();
    expect(s.text).toContain('What is your name? ');

    s.type('Priya\r');
    await s.finished;
    expect(s.text).toContain('Hello, Priya!');
  });

  it('echoes what is typed, since a pty does not', async () => {
    const s = new Session(GREETING);
    await s.settle();
    s.type('Ada\r');
    await s.finished;
    // OUTPUT always ends its line, so the echo lands on the line below.
    expect(s.text).toContain('What is your name? \nAda\n');
  });

  it('rubs out a character on backspace', async () => {
    const s = new Session(GREETING);
    await s.settle();
    s.type('Adax');
    s.type('\x7f');
    s.type('\r');
    await s.finished;
    expect(s.text).toContain('Hello, Ada!');
    // The echo walks the cursor back over the character it is removing.
    expect(s.raw).toContain('\b \b');
  });

  it('does not rub out past the start of the line', async () => {
    const s = new Session(GREETING);
    await s.settle();
    s.type('\x7f\x7f\x7f');
    s.type('Bo\r');
    await s.finished;
    expect(s.text).toContain('Hello, Bo!');
  });

  it('ignores arrow keys rather than echoing the escape sequence', async () => {
    const s = new Session(GREETING);
    await s.settle();
    s.type('Jo\x1b[Dhn\r');
    await s.finished;
    expect(s.text).toContain('Hello, John!');
  });

  it('keeps a line typed before INPUT asked for it', async () => {
    const s = new Session(
      programFile('twice.pseudo', [
        'DECLARE A : STRING',
        'DECLARE B : STRING',
        'INPUT A',
        'INPUT B',
        'OUTPUT A, "-", B',
      ]),
    );
    await s.settle();
    // Both lines arrive while the program is still on the first INPUT.
    s.type('one\rtwo\r');
    await s.finished;
    expect(s.text).toContain('one-two');
  });

  it('treats Ctrl+D as the end of input', async () => {
    const s = new Session(
      programFile('eof.pseudo', ['DECLARE A : STRING', 'INPUT A', 'OUTPUT "[", A, "]"']),
    );
    await s.settle();
    s.type('\x04');
    await s.finished;
    // An INPUT with nothing left to read is an error, not an empty string --
    // the same thing the CLI reports when stdin closes.
    expect(s.text).toContain('error[E3052]');
    expect(s.text).toContain('[Failed]');
  });

  it('stops an endless loop on Ctrl+C', async () => {
    const s = new Session(
      programFile('forever.pseudo', [
        'DECLARE N : INTEGER',
        'N <- 0',
        'WHILE N >= 0',
        '   N <- N + 1',
        'ENDWHILE',
      ]),
    );
    await s.settle();
    s.type('\x03');
    await s.finished;
    expect(s.text).toContain('^C');
    expect(s.text).toContain('[Stopped]');
  });

  it('reports a syntax error instead of running', async () => {
    const s = new Session(programFile('bad.pseudo', ['DECLARE Total : INTEGER', 'Total = 0']));
    await s.finished;
    expect(s.text).toContain('error[E2001]');
    expect(s.text).toContain('Total <- 0');
    expect(s.text).toContain('[Failed]');
  });

  it('reports a runtime error after the output it managed to print', async () => {
    const s = new Session(
      programFile('late.pseudo', [
        'DECLARE Marks : ARRAY[1:3] OF INTEGER',
        'OUTPUT "before"',
        'Marks[9] <- 1',
      ]),
    );
    await s.finished;
    expect(s.text).toContain('before');
    expect(s.text).toContain('error[E3082]');
    expect(s.text).toContain('[Failed]');
  });

  it('colours only the heading of a diagnostic', async () => {
    const s = new Session(programFile('colour.pseudo', ['DECLARE X : INTEGER', 'OUTPUT X']));
    await s.finished;
    expect(s.raw).toContain('\x1b[31merror[E3001]:\x1b[0m');
    // The quoted source line is left alone, so it stays readable.
    expect(s.raw).toContain('OUTPUT X');
  });

  it('resolves OPENFILE against the folder holding the program', async () => {
    writeFileSync(join(folder, 'data.txt'), 'from disk\n', 'utf8');
    const s = new Session(
      programFile('reader.pseudo', [
        'DECLARE Line : STRING',
        'OPENFILE "data.txt" FOR READ',
        'READFILE "data.txt", Line',
        'CLOSEFILE "data.txt"',
        'OUTPUT Line',
      ]),
    );
    await s.finished;
    expect(s.text).toContain('from disk');
  });

  it('flushes a file the program forgot to close, and warns', async () => {
    const s = new Session(
      programFile('writer.pseudo', [
        'OPENFILE "out.txt" FOR WRITE',
        'WRITEFILE "out.txt", "kept"',
      ]),
    );
    await s.finished;
    expect(readFileSync(join(folder, 'out.txt'), 'utf8')).toContain('kept');
    expect(s.text).toContain('warning[W1001]');
  });
});

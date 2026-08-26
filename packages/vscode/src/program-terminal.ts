import {
  DEFAULT_RUN_OPTIONS,
  Interpreter,
  PseudoError,
  type RunOptions,
  SourceFile,
  parseSource,
  renderAll,
} from '@pseudo-lang/core';
import { ExtensionHost, HaltSignal } from './host';

const ESC = '\x1b[';
const DIM = `${ESC}2m`;
const RED = `${ESC}31m`;
const YELLOW = `${ESC}33m`;
const RESET = `${ESC}0m`;

const CTRL_C = '\x03';
const CTRL_D = '\x04';
const BACKSPACE = '\x7f';
const ESCAPE = '\x1b';

/**
 * Runs one pseudocode program against a terminal, in this process.
 *
 * Deliberately free of any `vscode` import: the line discipline below is the
 * fiddly part and it is worth being able to test it without an editor. The
 * Pseudoterminal in run.ts is a thin wrapper over this.
 */
export class ProgramRunner {
  /** Characters typed since the last Enter. */
  private line = '';
  /** Lines typed but not yet consumed by INPUT, so typing ahead works. */
  private readonly typed: string[] = [];
  private waiting: ((line: string | null) => void) | null = null;

  private stopped = false;
  private endOfInput = false;
  private running = false;

  /** Where we are inside an escape sequence, if we are inside one at all. */
  private escape: 'none' | 'esc' | 'csi' = 'none';

  constructor(
    private readonly path: string,
    private readonly text: string,
    private readonly options: Partial<RunOptions>,
    private readonly emit: (text: string) => void,
  ) {}

  /** Raw keystrokes, exactly as the terminal delivers them. */
  handleInput(data: string): void {
    for (const ch of data) {
      // A program stuck in an endless loop has to be stoppable.
      if (ch === CTRL_C) {
        this.write(`${DIM}^C${RESET}\n`);
        this.stop();
        return;
      }

      // Ctrl+D is end of input, which is what a program reading until EOF from
      // the keyboard needs in order to ever finish.
      if (ch === CTRL_D) {
        this.endOfInput = true;
        this.wake(null);
        continue;
      }

      if (!this.running) continue;

      if (ch === '\r' || ch === '\n') {
        this.write('\n');
        const line = this.line;
        this.line = '';
        if (!this.wake(line)) this.typed.push(line);
        continue;
      }

      if (ch === BACKSPACE || ch === '\b') {
        if (this.line.length > 0) {
          this.line = this.line.slice(0, -1);
          // Move back, paint a space over the character, move back again.
          this.write('\b \b');
        }
        continue;
      }

      // Arrow keys and the other escape sequences have no meaning on a line
      // this simple, and the parts of them that happen to be printable would
      // otherwise land in the middle of the answer: a left arrow is ESC [ D,
      // and dropping only the ESC leaves "[D" behind.
      if (this.escape !== 'none') {
        this.escape = this.consumeEscape(ch);
        continue;
      }
      if (ch === ESCAPE) {
        this.escape = 'esc';
        continue;
      }

      if (ch < ' ') continue;

      this.line += ch;
      this.write(ch);
    }
  }

  /** Runs the little state machine that swallows one escape sequence. */
  private consumeEscape(ch: string): 'none' | 'esc' | 'csi' {
    if (this.escape === 'esc') return ch === '[' ? 'csi' : 'none';
    // Inside a CSI: parameter and intermediate bytes, then one final byte.
    return ch >= '@' && ch <= '~' ? 'none' : 'csi';
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
    this.wake(null);
  }

  async run(): Promise<void> {
    const source = new SourceFile(this.path, this.text);
    const parsed = parseSource(source);

    for (const warning of parsed.warnings) this.diagnostics([warning], source, YELLOW);

    if (parsed.program === null) {
      this.diagnostics(parsed.errors, source, RED);
      this.finish('Failed');
      return;
    }

    const host = new ExtensionHost(this.path, {
      write: (text) => this.write(text),
      readLine: () => this.readLine(),
      // Checked before every statement, so Ctrl+C lands even mid-loop.
      beforeStatement: async () => {
        if (this.stopped) throw new HaltSignal();
      },
    });

    const interpreter = new Interpreter(host, { ...DEFAULT_RUN_OPTIONS, ...this.options });

    this.running = true;
    try {
      await interpreter.run(parsed.program);
      this.diagnostics(await interpreter.closeAll(), source, YELLOW);
      this.finish('Finished');
    } catch (err) {
      // Files are flushed on every path, so a program that fails late does not
      // also lose the output it had already written.
      if (err instanceof HaltSignal) {
        await interpreter.closeAll();
        this.finish('Stopped');
      } else if (err instanceof PseudoError) {
        await interpreter.closeAll();
        this.diagnostics([err], source, RED);
        this.finish('Failed');
      } else {
        await interpreter.closeAll();
        this.write(`\n${RED}internal error${RESET}\n${String(err)}\n`);
        this.finish('Failed');
      }
    }
  }

  // --------------------------------------------------------------- internals

  private readLine(): Promise<string | null> {
    const queued = this.typed.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.stopped || this.endOfInput) return Promise.resolve(null);
    return new Promise<string | null>((resolve) => {
      this.waiting = resolve;
    });
  }

  private wake(line: string | null): boolean {
    const waiting = this.waiting;
    if (waiting === null) return false;
    this.waiting = null;
    waiting(line);
    return true;
  }

  private write(text: string): void {
    // A pty is raw: a bare newline drops a line without returning the carriage,
    // so every line after the first would start where the last one ended.
    this.emit(text.replace(/\r?\n/g, '\r\n'));
  }

  private diagnostics(errors: PseudoError[], source: SourceFile, colour: string): void {
    if (errors.length === 0) return;
    this.write(`\n${paint(renderAll(errors, source), colour)}\n`);
  }

  private finish(label: string): void {
    this.running = false;
    this.write(`\n${DIM}[${label}]${RESET}\n`);
  }
}

/**
 * Colours only the `error[E2001]:` heading of each diagnostic. The caret lines
 * below are already doing the pointing, and painting the whole block makes the
 * quoted source harder to read rather than easier.
 */
function paint(rendered: string, colour: string): string {
  return rendered.replace(/^(error|warning)(\[[EW]\d+\]:)/gm, `${colour}$1$2${RESET}`);
}

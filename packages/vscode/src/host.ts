import type { Frame, Host, HostFileSystem, Stmt } from '@pseudo-lang/core';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

/** Thrown to unwind the interpreter when the program is asked to stop. */
export class HaltSignal extends Error {
  constructor() {
    super('halted');
    this.name = 'HaltSignal';
  }
}

/** Statements between clock readings. Small enough to stay responsive. */
const CHECK_EVERY = 512;

/** Upper bound on how long a keystroke waits behind a running program. */
const YIELD_INTERVAL_MS = 50;

export interface HostHooks {
  write(text: string): void;
  readLine(): Promise<string | null>;
  /** Only the debugger parks here. Running a file leaves it out. */
  beforeStatement?(stmt: Stmt, stack: readonly Frame[]): Promise<void>;
}

/**
 * The Host both the Run command and the debug adapter run the interpreter
 * against, inside the extension host.
 *
 * Everything the program does to the outside world arrives here, which is what
 * lets one caller turn OUTPUT into terminal bytes and another turn it into a
 * debug-console event without the interpreter knowing either exists.
 */
export class ExtensionHost implements Host {
  private readonly folder: string;

  private sinceCheck = 0;
  private lastYield = Date.now();

  constructor(
    program: string,
    private readonly hooks: HostHooks,
    private seed = Math.floor(Math.random() * 2 ** 31),
  ) {
    this.folder = dirname(program);
  }

  async write(text: string): Promise<void> {
    this.hooks.write(text);
  }

  readLine(): Promise<string | null> {
    return this.hooks.readLine();
  }

  async beforeStatement(stmt: Stmt, stack: readonly Frame[]): Promise<void> {
    await this.pump();
    await this.hooks.beforeStatement?.(stmt, stack);
  }

  /**
   * Hands the event loop back periodically.
   *
   * Awaiting a hook only drains microtasks, so a program in a tight loop never
   * reaches the phase where a keystroke is delivered. Without this, Ctrl+C and
   * the debugger's Pause button -- the two things that exist precisely for an
   * endless loop -- are the two things an endless loop makes unreachable.
   *
   * Yielding on a timer rather than a statement count keeps the cost off the
   * hot path: the counter avoids reading the clock every statement, and the
   * clock keeps a fast program from sleeping away its throughput.
   */
  private async pump(): Promise<void> {
    this.sinceCheck += 1;
    if (this.sinceCheck < CHECK_EVERY) return;
    this.sinceCheck = 0;

    const now = Date.now();
    if (now - this.lastYield < YIELD_INTERVAL_MS) return;
    this.lastYield = now;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  fs: HostFileSystem = {
    readFileLines: async (path) => {
      const lines = (await readFile(path, 'utf8')).split(/\r\n|\n|\r/);
      if (lines.at(-1) === '') lines.pop();
      return lines;
    },
    writeFile: async (path, data, append) => {
      await writeFile(path, data, { encoding: 'utf8', flag: append ? 'a' : 'w' });
    },
    readBinary: async (path) => new Uint8Array(await readFile(path)),
    writeBinary: async (path, data) => {
      await writeFile(path, data);
    },
    exists: async (path) => existsSync(path),
  };

  random(): number {
    this.seed = (this.seed * 1103515245 + 12345) % 2147483648;
    return this.seed / 2147483648;
  }

  resolvePath(relative: string): string {
    return isAbsolute(relative) ? relative : resolve(this.folder, relative);
  }
}

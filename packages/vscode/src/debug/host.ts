import type { Frame, Host, HostFileSystem, Stmt } from '@pseudo-lang/core';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

/** Thrown to unwind the interpreter when the session is asked to stop. */
export class HaltSignal extends Error {
  constructor() {
    super('halted');
    this.name = 'HaltSignal';
  }
}

export interface DebugHooks {
  write(text: string): void;
  readLine(): Promise<string | null>;
  beforeStatement(stmt: Stmt, stack: readonly Frame[]): Promise<void>;
}

/**
 * The Host the debug session runs the interpreter against.
 *
 * Everything the program does to the outside world arrives here, which is what
 * lets the session turn OUTPUT into a debug-console event and INPUT into a
 * prompt without the interpreter knowing either exists.
 */
export class DebugHost implements Host {
  private readonly folder: string;

  constructor(
    private readonly program: string,
    private readonly hooks: DebugHooks,
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

  beforeStatement(stmt: Stmt, stack: readonly Frame[]): Promise<void> {
    return this.hooks.beforeStatement(stmt, stack);
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

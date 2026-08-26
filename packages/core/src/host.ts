import type { Stmt } from './parser/ast';

export interface Frame {
  name: string;
  line: number;
  /** Present for every frame except `<main>`. */
  scopeId: number;
}

export interface HostFileSystem {
  readFileLines(path: string): Promise<string[]>;
  writeFile(path: string, data: string, append: boolean): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/**
 * The only seam between the language and its environment. `core` performs no
 * I/O of its own, which is what lets the CLI, the debug adapter and the tests
 * drive the same interpreter.
 */
export interface Host {
  write(text: string): Promise<void>;
  /** Resolves to null at end of input. */
  readLine(): Promise<string | null>;
  /**
   * Called before every statement. The CLI returns immediately; the debug
   * adapter parks here while stepping or stopped at a breakpoint.
   */
  beforeStatement(stmt: Stmt, stack: readonly Frame[]): Promise<void>;
  fs: HostFileSystem;
  /** Injectable so RAND is testable. */
  random(): number;
  /** Resolves a path from a pseudocode program against the program's folder. */
  resolvePath(relative: string): string;
}

export interface RunOptions {
  strictDeclarations: boolean;
  maxCallDepth: number;
  randomFileRecordSize: number;
}

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  strictDeclarations: false,
  maxCallDepth: 2000,
  randomFileRecordSize: 512,
};

/** A Host that captures output and replays scripted input. Used by the tests. */
export class TestHost implements Host {
  readonly output: string[] = [];
  private inputIndex = 0;
  private seed: number;

  constructor(
    private readonly input: string[] = [],
    seed = 1,
    private readonly files = new Map<string, string>(),
  ) {
    this.seed = seed;
  }

  async write(text: string): Promise<void> {
    this.output.push(text);
  }

  async readLine(): Promise<string | null> {
    if (this.inputIndex >= this.input.length) return null;
    const line = this.input[this.inputIndex] ?? null;
    this.inputIndex += 1;
    return line;
  }

  async beforeStatement(): Promise<void> {
    // no-op
  }

  fs: HostFileSystem = {
    readFileLines: async (path) => {
      const text = this.files.get(path);
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      const lines = text.split(/\r\n|\n|\r/);
      if (lines.at(-1) === '') lines.pop();
      return lines;
    },
    writeFile: async (path, data, append) => {
      const prev = append ? (this.files.get(path) ?? '') : '';
      this.files.set(path, prev + data);
    },
    readBinary: async (path) => {
      const text = this.files.get(path) ?? '';
      return Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
    },
    writeBinary: async (path, data) => {
      this.files.set(path, String.fromCharCode(...data));
    },
    exists: async (path) => this.files.has(path),
  };

  /** Deterministic 32-bit LCG so RAND is reproducible in tests. */
  random(): number {
    this.seed = (this.seed * 1103515245 + 12345) % 2147483648;
    return this.seed / 2147483648;
  }

  resolvePath(relative: string): string {
    return relative;
  }

  get text(): string {
    return this.output.join('');
  }

  fileContents(path: string): string | undefined {
    return this.files.get(path);
  }
}

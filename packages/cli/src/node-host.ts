import { createInterface, type Interface } from 'node:readline';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Frame, Host, HostFileSystem } from '@pseudo-lang/core';

export class NodeHost implements Host {
  private readonly baseDir: string;
  private reader: Interface | null = null;
  private queue: string[] = [];
  private closed = false;
  private waiting: ((line: string | null) => void) | null = null;
  private rng: () => number;

  constructor(programPath: string, seed?: number) {
    this.baseDir = dirname(resolve(programPath));
    this.rng = seed === undefined ? Math.random : lcg(seed);
  }

  async write(text: string): Promise<void> {
    process.stdout.write(text);
  }

  async readLine(): Promise<string | null> {
    if (this.queue.length > 0) return this.queue.shift() ?? null;
    if (this.closed) return null;

    if (this.reader === null) {
      this.reader = createInterface({ input: process.stdin, terminal: false });
      this.reader.on('line', (line) => {
        if (this.waiting !== null) {
          const resolveWaiting = this.waiting;
          this.waiting = null;
          resolveWaiting(line);
        } else {
          this.queue.push(line);
        }
      });
      this.reader.on('close', () => {
        this.closed = true;
        if (this.waiting !== null) {
          const resolveWaiting = this.waiting;
          this.waiting = null;
          resolveWaiting(null);
        }
      });
    }

    if (this.queue.length > 0) return this.queue.shift() ?? null;
    return new Promise<string | null>((res) => {
      this.waiting = res;
    });
  }

  async beforeStatement(_stmt: unknown, _stack: readonly Frame[]): Promise<void> {
    // The CLI never pauses.
  }

  fs: HostFileSystem = {
    readFileLines: async (path) => {
      const text = await fs.readFile(path, 'utf8');
      const lines = text.split(/\r\n|\n|\r/);
      if (lines.at(-1) === '') lines.pop();
      return lines;
    },
    writeFile: async (path, data, append) => {
      if (append) await fs.appendFile(path, data, 'utf8');
      else await fs.writeFile(path, data, 'utf8');
    },
    readBinary: async (path) => new Uint8Array(await fs.readFile(path)),
    writeBinary: async (path, data) => {
      await fs.writeFile(path, data);
    },
    exists: async (path) => {
      try {
        await fs.stat(path);
        return true;
      } catch {
        return false;
      }
    },
  };

  random(): number {
    return this.rng();
  }

  resolvePath(relative: string): string {
    return isAbsolute(relative) ? relative : resolve(this.baseDir, relative);
  }

  dispose(): void {
    this.reader?.close();
  }
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

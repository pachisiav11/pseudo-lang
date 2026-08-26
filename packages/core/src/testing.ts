import { SourceFile } from './diagnostics/error';
import { TestHost } from './host';
import type { RunOptions } from './host';
import { type RunResult, runSource } from './run';

export interface ExecResult extends RunResult {
  output: string;
  host: TestHost;
  /** First error code, or null. Convenient in expectations. */
  code: string | null;
}

/** Runs a program against a captured host. Used throughout the test suite. */
export async function exec(
  program: string,
  input: string[] = [],
  options: Partial<RunOptions> = {},
  files: Map<string, string> = new Map(),
): Promise<ExecResult> {
  const host = new TestHost(input, 1, files);
  const source = new SourceFile('test.pseudo', program);
  const result = await runSource(source, host, options);
  return {
    ...result,
    output: host.text,
    host,
    code: result.errors[0]?.code ?? null,
  };
}

/** Runs a program and asserts it succeeded, returning its output. */
export async function outputOf(program: string, input: string[] = []): Promise<string> {
  const result = await exec(program, input);
  if (!result.ok) {
    const first = result.errors[0];
    throw new Error(`program failed: ${first?.code} ${first?.message}`);
  }
  return result.output;
}

/** Runs a program and asserts it failed, returning the first diagnostic code. */
export async function errorOf(program: string, input: string[] = []): Promise<string> {
  const result = await exec(program, input);
  if (result.ok) throw new Error('expected the program to fail, but it succeeded');
  return result.errors[0]?.code ?? 'none';
}

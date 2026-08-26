import { DiagnosticSink, PseudoError, type SourceFile } from './diagnostics/error';
import { DEFAULT_RUN_OPTIONS, type Host, type RunOptions } from './host';
import { lex } from './lexer/lexer';
import type { Program } from './parser/ast';
import { parse } from './parser/parser';
import { Interpreter } from './runtime/interpreter';

export interface ParseResult {
  program: Program | null;
  errors: PseudoError[];
  warnings: PseudoError[];
}

export function parseSource(source: SourceFile): ParseResult {
  const sink = new DiagnosticSink();
  const { tokens } = lex(source, sink);
  if (sink.hasErrors) {
    return { program: null, errors: sink.errors, warnings: sink.warnings };
  }
  const { program } = parse(tokens, sink);
  return {
    program: sink.hasErrors ? null : program,
    errors: sink.errors,
    warnings: sink.warnings,
  };
}

export interface RunResult {
  ok: boolean;
  errors: PseudoError[];
  warnings: PseudoError[];
}

export async function runSource(
  source: SourceFile,
  host: Host,
  options: Partial<RunOptions> = {},
): Promise<RunResult> {
  const parsed = parseSource(source);
  if (parsed.program === null) {
    return { ok: false, errors: parsed.errors, warnings: parsed.warnings };
  }

  const interpreter = new Interpreter(host, { ...DEFAULT_RUN_OPTIONS, ...options });
  const warnings = [...parsed.warnings];
  try {
    await interpreter.run(parsed.program);
  } catch (err) {
    if (err instanceof PseudoError) {
      // Still flush open files, so a program that fails late does not also
      // lose the output it had already written.
      await interpreter.closeAll();
      return { ok: false, errors: [err], warnings };
    }
    throw err;
  }
  warnings.push(...(await interpreter.closeAll()));
  return { ok: true, errors: [], warnings };
}

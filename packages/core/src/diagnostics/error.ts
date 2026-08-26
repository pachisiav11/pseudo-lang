import { type DiagCode, isWarning, summaryOf } from './codes';

export interface Span {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

export function span(line: number, col: number, endLine = line, endCol = col + 1): Span {
  return { line, col, endLine, endCol };
}

export function mergeSpans(a: Span, b: Span): Span {
  return { line: a.line, col: a.col, endLine: b.endLine, endCol: b.endCol };
}

export interface DiagnosticInit {
  /** Overrides the catalogue summary when the specific case reads better. */
  message?: string;
  /** Text placed beside the caret, under the offending source. */
  label?: string;
  /** Multi-line advice printed under a `help:` heading. */
  help?: string;
  /** Extra "see also" lines, e.g. pointing at a declaration. */
  notes?: string[];
}

export class PseudoError extends Error {
  readonly code: DiagCode;
  readonly span: Span;
  readonly label: string | undefined;
  readonly help: string | undefined;
  readonly notes: string[];
  /** Innermost-first subprogram names, filled in by the interpreter. */
  callStack: string[] = [];

  constructor(code: DiagCode, span: Span, init: DiagnosticInit = {}) {
    super(init.message ?? summaryOf(code));
    this.name = 'PseudoError';
    this.code = code;
    this.span = span;
    this.label = init.label;
    this.help = init.help;
    this.notes = init.notes ?? [];
  }
}

export class SourceFile {
  readonly lines: string[];

  constructor(
    readonly name: string,
    readonly text: string,
  ) {
    this.lines = text.split(/\r\n|\n|\r/);
  }

  /** 1-based. Returns an empty string for out-of-range lines. */
  line(n: number): string {
    return this.lines[n - 1] ?? '';
  }
}

/**
 * Renders one diagnostic in the style fixed by BUILD_GUIDE.md section 16.
 *
 *   error[E2001]: `=` cannot be used to assign a value
 *     --> volume.pseudo:7:7
 *      |
 *    7 | Total = 0
 *      |       ^ this is a comparison operator
 *      |
 *   help: assignment in 9618 pseudocode is written with a left arrow
 *         Total <- 0
 */
const CALL_STACK_LIMIT = 10;

export function renderDiagnostic(err: PseudoError, source: SourceFile): string {
  const severity = isWarning(err.code) ? 'warning' : 'error';
  const out: string[] = [];

  out.push(`${severity}[${err.code}]: ${err.message}`);

  const gutter = ' '.repeat(String(err.span.line).length);
  out.push(`${gutter}--> ${source.name}:${err.span.line}:${err.span.col}`);
  out.push(`${gutter} |`);

  const text = source.line(err.span.line);
  out.push(`${err.span.line} | ${text}`);

  const caretPad = ' '.repeat(Math.max(0, err.span.col - 1));
  const width = err.span.endLine === err.span.line ? Math.max(1, err.span.endCol - err.span.col) : 1;
  const carets = '^'.repeat(width);
  out.push(`${gutter} | ${caretPad}${carets}${err.label ? ` ${err.label}` : ''}`);
  out.push(`${gutter} |`);

  for (const note of err.notes) {
    out.push(`note: ${note}`);
  }

  if (err.help !== undefined) {
    const [first, ...rest] = err.help.split('\n');
    out.push(`help: ${first ?? ''}`);
    for (const line of rest) out.push(`      ${line}`);
  }

  if (err.callStack.length > 0) {
    out.push('');
    out.push('call stack (innermost first):');
    // Runaway recursion produces thousands of identical frames. The innermost
    // few and the count say everything the whole list would.
    const shown = err.callStack.slice(0, CALL_STACK_LIMIT);
    for (const frame of shown) out.push(`  ${frame}`);
    const hidden = err.callStack.length - shown.length;
    if (hidden > 0) out.push(`  ... and ${hidden} more`);
  }

  return out.join('\n');
}

export function renderAll(errors: PseudoError[], source: SourceFile): string {
  return errors.map((e) => renderDiagnostic(e, source)).join('\n\n');
}

/** Collects diagnostics so a single run can report more than one problem. */
export class DiagnosticSink {
  readonly errors: PseudoError[] = [];
  readonly warnings: PseudoError[] = [];

  add(err: PseudoError): void {
    if (isWarning(err.code)) this.warnings.push(err);
    else this.errors.push(err);
  }

  report(code: DiagCode, span: Span, init: DiagnosticInit = {}): void {
    this.add(new PseudoError(code, span, init));
  }

  get hasErrors(): boolean {
    return this.errors.length > 0;
  }
}

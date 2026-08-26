import type { DiagCode } from '../diagnostics/codes';
import { type DiagnosticInit, PseudoError, type Span } from '../diagnostics/error';
import { BUILTIN_NAMES } from '../lexer/keywords';
import { type PValue, bool, char, int, real, str, valueTypeName } from './value';

/** What a built-in needs from the interpreter, without importing it. */
export interface BuiltinHost {
  random(): number;
  /** True when the named file has no more lines to read. */
  fileAtEnd(fileName: string, span: Span): boolean;
  error(code: DiagCode, span: Span, init?: DiagnosticInit): PseudoError;
}

type ArgType = 'STRING' | 'CHAR' | 'INTEGER' | 'REAL' | 'NUMBER';

interface Builtin {
  params: ArgType[];
  call(args: PValue[], host: BuiltinHost, span: Span): PValue;
}

function text(value: PValue): string {
  return (value as { v: string }).v;
}

function num(value: PValue): number {
  return (value as { v: number }).v;
}

export const BUILTINS: Record<string, Builtin> = {
  RIGHT: {
    params: ['STRING', 'INTEGER'],
    call(args, host, span) {
      const s = text(args[0] as PValue);
      const x = num(args[1] as PValue);
      if (x < 0 || x > s.length) {
        throw host.error('E3091', span, {
          message: `RIGHT cannot take ${x} characters from a string of length ${s.length}`,
          label: 'out of range',
        });
      }
      return str(s.slice(s.length - x));
    },
  },

  LENGTH: {
    params: ['STRING'],
    call(args) {
      return int(text(args[0] as PValue).length);
    },
  },

  MID: {
    params: ['STRING', 'INTEGER', 'INTEGER'],
    call(args, host, span) {
      const s = text(args[0] as PValue);
      const x = num(args[1] as PValue);
      const y = num(args[2] as PValue);
      // String positions are 1-based: MID("ABCDEFGH", 2, 3) is "BCD".
      if (x < 1 || y < 0 || x + y - 1 > s.length) {
        throw host.error('E3091', span, {
          message: `MID cannot take ${y} characters from position ${x} of a string of length ${s.length}`,
          label: 'out of range',
          help: 'String positions start at 1.',
        });
      }
      return str(s.slice(x - 1, x - 1 + y));
    },
  },

  LCASE: {
    params: ['CHAR'],
    call(args) {
      return char(text(args[0] as PValue).toLowerCase());
    },
  },

  UCASE: {
    params: ['CHAR'],
    call(args) {
      return char(text(args[0] as PValue).toUpperCase());
    },
  },

  INT: {
    params: ['NUMBER'],
    call(args) {
      return int(Math.trunc(num(args[0] as PValue)));
    },
  },

  RAND: {
    params: ['INTEGER'],
    call(args, host, span) {
      const x = num(args[0] as PValue);
      if (x <= 0) {
        throw host.error('E3097', span, {
          message: `RAND needs a positive whole number, but was given ${x}`,
          label: 'not positive',
        });
      }
      return real(host.random() * x);
    },
  },

  EOF: {
    params: ['STRING'],
    call(args, host, span) {
      return bool(host.fileAtEnd(text(args[0] as PValue), span));
    },
  },
};

export function isBuiltin(name: string): boolean {
  return Object.hasOwn(BUILTINS, name.toUpperCase()) && BUILTIN_NAMES.has(name.toUpperCase());
}

function matches(expected: ArgType, value: PValue): boolean {
  switch (expected) {
    case 'STRING':
      return value.t === 'STRING';
    case 'CHAR':
      return value.t === 'CHAR';
    case 'INTEGER':
      return value.t === 'INTEGER';
    case 'REAL':
      return value.t === 'REAL' || value.t === 'INTEGER';
    case 'NUMBER':
      return value.t === 'REAL' || value.t === 'INTEGER';
  }
}

function describe(expected: ArgType): string {
  return expected === 'NUMBER' ? 'a number' : `a ${expected}`;
}

export function callBuiltin(
  name: string,
  args: PValue[],
  argSpans: Span[],
  host: BuiltinHost,
  span: Span,
): PValue {
  const upper = name.toUpperCase();
  const builtin = BUILTINS[upper];
  if (builtin === undefined) {
    throw host.error('E3090', span, { message: `\`${name}\` is not a known function` });
  }

  if (args.length !== builtin.params.length) {
    throw host.error('E3093', span, {
      message: `${upper} takes ${builtin.params.length} argument${builtin.params.length === 1 ? '' : 's'}, but ${args.length} ${args.length === 1 ? 'was' : 'were'} given`,
      label: 'wrong number of arguments',
    });
  }

  for (let i = 0; i < args.length; i += 1) {
    const expected = builtin.params[i];
    const value = args[i];
    if (expected === undefined || value === undefined) continue;
    if (!matches(expected, value)) {
      throw host.error('E3096', argSpans[i] ?? span, {
        message: `argument ${i + 1} of ${upper} must be ${describe(expected)}, but this is ${valueTypeName(value)}`,
        label: `this is ${valueTypeName(value)}`,
        help:
          expected === 'CHAR' && value.t === 'STRING'
            ? `${upper} works on a single CHAR. Use single quotes, for example ${upper}('W').`
            : undefined,
      });
    }
  }

  return builtin.call(args, host, span);
}

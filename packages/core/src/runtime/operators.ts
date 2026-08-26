import { PseudoError, type Span } from '../diagnostics/error';
import type { BinOp, UnOp } from '../parser/ast';
import { commonNumeric, isNumeric } from './types';
import { type PValue, bool, char, int, real, str, typeOfValue, valueTypeName } from './value';

const SYMBOL: Record<BinOp, string> = {
  ADD: '+',
  SUB: '-',
  MUL: '*',
  DIV_REAL: '/',
  DIV_INT: 'DIV',
  MOD: 'MOD',
  CONCAT: '&',
  EQ: '=',
  NEQ: '<>',
  LT: '<',
  LTE: '<=',
  GT: '>',
  GTE: '>=',
  AND: 'AND',
  OR: 'OR',
};

function numberOf(v: PValue): number | null {
  return v.t === 'INTEGER' || v.t === 'REAL' ? v.v : null;
}

function textOf(v: PValue): string | null {
  return v.t === 'STRING' || v.t === 'CHAR' ? v.v : null;
}

function mismatch(op: BinOp, left: PValue, right: PValue, span: Span): PseudoError {
  return new PseudoError('E3014', span, {
    message: `\`${SYMBOL[op]}\` cannot be applied to ${valueTypeName(left)} and ${valueTypeName(right)}`,
    label: `${valueTypeName(left)} ${SYMBOL[op]} ${valueTypeName(right)}`,
  });
}

/** DIV truncates toward zero; MOD keeps the sign of the dividend. */
function intDiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

function intMod(a: number, b: number): number {
  return a - intDiv(a, b) * b;
}

function compareOrdered(left: PValue, right: PValue, span: Span, op: BinOp): number {
  const ln = numberOf(left);
  const rn = numberOf(right);
  if (ln !== null && rn !== null) return ln === rn ? 0 : ln < rn ? -1 : 1;

  if (left.t === 'STRING' && right.t === 'STRING') {
    return left.v === right.v ? 0 : left.v < right.v ? -1 : 1;
  }
  if (left.t === 'CHAR' && right.t === 'CHAR') {
    return left.v === right.v ? 0 : left.v < right.v ? -1 : 1;
  }
  if (left.t === 'DATE' && right.t === 'DATE') {
    const a = left.year * 10000 + left.month * 100 + left.day;
    const b = right.year * 10000 + right.month * 100 + right.day;
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (left.t === 'ENUM' && right.t === 'ENUM' && left.typeName === right.typeName) {
    return left.ordinal === right.ordinal ? 0 : left.ordinal < right.ordinal ? -1 : 1;
  }
  throw mismatch(op, left, right, span);
}

function looseEquals(left: PValue, right: PValue, span: Span): boolean {
  const ln = numberOf(left);
  const rn = numberOf(right);
  if (ln !== null && rn !== null) return ln === rn;

  if (left.t !== right.t) {
    throw new PseudoError('E3013', span, {
      message: `cannot compare ${valueTypeName(left)} with ${valueTypeName(right)}`,
      label: 'incompatible types',
      help:
        (left.t === 'CHAR' && right.t === 'STRING') || (left.t === 'STRING' && right.t === 'CHAR')
          ? 'CHAR and STRING are different types. A CHAR uses single quotes and\na STRING uses double quotes.'
          : undefined,
    });
  }

  switch (left.t) {
    case 'STRING':
    case 'CHAR':
      return left.v === (right as { v: string }).v;
    case 'BOOLEAN':
      return left.v === (right as { v: boolean }).v;
    case 'DATE': {
      const r = right as Extract<PValue, { t: 'DATE' }>;
      return left.day === r.day && left.month === r.month && left.year === r.year;
    }
    case 'ENUM': {
      const r = right as Extract<PValue, { t: 'ENUM' }>;
      if (left.typeName !== r.typeName) {
        throw new PseudoError('E3013', span, {
          message: `cannot compare ${left.typeName} with ${r.typeName}`,
          label: 'different enumerated types',
        });
      }
      return left.ordinal === r.ordinal;
    }
    case 'SET': {
      const r = right as Extract<PValue, { t: 'SET' }>;
      if (left.members.length !== r.members.length) return false;
      return left.members.every((m) => r.members.some((n) => looseEquals(m, n, span)));
    }
    case 'POINTER': {
      const r = right as Extract<PValue, { t: 'POINTER' }>;
      return left.cell === r.cell;
    }
    case 'OBJECT': {
      const r = right as Extract<PValue, { t: 'OBJECT' }>;
      return left.obj === r.obj;
    }
    default:
      throw new PseudoError('E3013', span, {
        message: `values of type ${valueTypeName(left)} cannot be compared`,
        label: 'not comparable',
      });
  }
}

export function applyBinary(op: BinOp, left: PValue, right: PValue, span: Span): PValue {
  switch (op) {
    case 'ADD':
    case 'SUB':
    case 'MUL': {
      const a = numberOf(left);
      const b = numberOf(right);
      if (a === null || b === null) throw mismatch(op, left, right, span);
      const value = op === 'ADD' ? a + b : op === 'SUB' ? a - b : a * b;
      const target = commonNumeric(typeOfValue(left), typeOfValue(right));
      return target.k === 'REAL' ? real(value) : int(value);
    }

    case 'DIV_REAL': {
      const a = numberOf(left);
      const b = numberOf(right);
      if (a === null || b === null) throw mismatch(op, left, right, span);
      if (b === 0) {
        throw new PseudoError('E3011', span, {
          message: 'division by zero',
          label: 'the right-hand side is 0',
        });
      }
      // The guide is explicit: `/` always produces a REAL.
      return real(a / b);
    }

    case 'DIV_INT':
    case 'MOD': {
      if (left.t !== 'INTEGER' || right.t !== 'INTEGER') {
        throw new PseudoError('E3010', span, {
          message: `\`${SYMBOL[op]}\` needs two INTEGER values, found ${valueTypeName(left)} and ${valueTypeName(right)}`,
          label: 'whole numbers only',
          help: 'Use INT(x) to take the whole part of a REAL first.',
        });
      }
      if (right.v === 0) {
        throw new PseudoError('E3011', span, {
          message: `\`${SYMBOL[op]}\` by zero`,
          label: 'the right-hand side is 0',
        });
      }
      return int(op === 'DIV_INT' ? intDiv(left.v, right.v) : intMod(left.v, right.v));
    }

    case 'CONCAT': {
      const a = textOf(left);
      const b = textOf(right);
      if (a === null || b === null) {
        throw new PseudoError('E3014', span, {
          message: `\`&\` joins text, but found ${valueTypeName(left)} and ${valueTypeName(right)}`,
          label: 'expected STRING or CHAR',
        });
      }
      return str(a + b);
    }

    case 'EQ':
      return bool(looseEquals(left, right, span));
    case 'NEQ':
      return bool(!looseEquals(left, right, span));
    case 'LT':
      return bool(compareOrdered(left, right, span, op) < 0);
    case 'LTE':
      return bool(compareOrdered(left, right, span, op) <= 0);
    case 'GT':
      return bool(compareOrdered(left, right, span, op) > 0);
    case 'GTE':
      return bool(compareOrdered(left, right, span, op) >= 0);

    case 'AND':
    case 'OR': {
      if (left.t !== 'BOOLEAN' || right.t !== 'BOOLEAN') {
        throw new PseudoError('E3014', span, {
          message: `\`${SYMBOL[op]}\` needs two BOOLEAN values, found ${valueTypeName(left)} and ${valueTypeName(right)}`,
          label: 'expected BOOLEAN',
        });
      }
      return bool(op === 'AND' ? left.v && right.v : left.v || right.v);
    }
  }
}

export function applyUnary(op: UnOp, operand: PValue, span: Span): PValue {
  switch (op) {
    case 'NEG': {
      if (operand.t === 'INTEGER') return int(-operand.v);
      if (operand.t === 'REAL') return real(-operand.v);
      throw new PseudoError('E3014', span, {
        message: `\`-\` cannot be applied to ${valueTypeName(operand)}`,
        label: 'expected a number',
      });
    }
    case 'NOT': {
      if (operand.t !== 'BOOLEAN') {
        throw new PseudoError('E3014', span, {
          message: `\`NOT\` needs a BOOLEAN, found ${valueTypeName(operand)}`,
          label: 'expected BOOLEAN',
        });
      }
      return bool(!operand.v);
    }
    case 'ADDR':
      throw new PseudoError('E3014', span, { message: '`^` is handled by the interpreter' });
  }
}

/** Exported for the operator table tests. */
export const _internals = { intDiv, intMod, isNumeric, char };

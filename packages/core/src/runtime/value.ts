import type { Cell } from './cell';
import { type Bound, type PType, sameType, typeName } from './types';

export interface ArrayValue {
  dims: Bound[];
  element: PType;
  /** Row-major, dense. */
  cells: Cell[];
}

export interface ObjectValue {
  className: string;
  fields: Map<string, Cell>;
}

export type PValue =
  | { t: 'INTEGER'; v: number }
  | { t: 'REAL'; v: number }
  | { t: 'CHAR'; v: string }
  | { t: 'STRING'; v: string }
  | { t: 'BOOLEAN'; v: boolean }
  | { t: 'DATE'; day: number; month: number; year: number }
  | { t: 'ARRAY'; arr: ArrayValue }
  | { t: 'RECORD'; typeName: string; fields: Map<string, Cell> }
  | { t: 'ENUM'; typeName: string; name: string; ordinal: number }
  | { t: 'SET'; typeName: string; members: PValue[] }
  | { t: 'POINTER'; typeName: string; target: PType; cell: Cell | null }
  | { t: 'OBJECT'; obj: ObjectValue };

export const int = (v: number): PValue => ({ t: 'INTEGER', v });
export const real = (v: number): PValue => ({ t: 'REAL', v });
export const str = (v: string): PValue => ({ t: 'STRING', v });
export const char = (v: string): PValue => ({ t: 'CHAR', v });
export const bool = (v: boolean): PValue => ({ t: 'BOOLEAN', v });

export function typeOfValue(value: PValue): PType {
  switch (value.t) {
    case 'INTEGER':
      return { k: 'INTEGER' };
    case 'REAL':
      return { k: 'REAL' };
    case 'CHAR':
      return { k: 'CHAR' };
    case 'STRING':
      return { k: 'STRING' };
    case 'BOOLEAN':
      return { k: 'BOOLEAN' };
    case 'DATE':
      return { k: 'DATE' };
    case 'ARRAY':
      return { k: 'ARRAY', dims: value.arr.dims, element: value.arr.element };
    case 'RECORD':
      return { k: 'RECORD', name: value.typeName };
    case 'ENUM':
      return { k: 'ENUM', name: value.typeName };
    case 'SET':
      return { k: 'SET', name: value.typeName, base: { k: 'STRING' } };
    case 'POINTER':
      return { k: 'POINTER', name: value.typeName, target: value.target };
    case 'OBJECT':
      return { k: 'CLASS', name: value.obj.className };
  }
}

export function valueTypeName(value: PValue): string {
  return typeName(typeOfValue(value));
}

/** Two decimal places is not the rule; the rule is "at least one digit". */
function formatReal(v: number): string {
  if (Number.isInteger(v) && Number.isFinite(v)) {
    return `${Object.is(v, -0) ? '-0' : String(v)}.0`;
  }
  return String(v);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatValue(value: PValue): string {
  switch (value.t) {
    case 'INTEGER':
      return String(value.v);
    case 'REAL':
      return formatReal(value.v);
    case 'CHAR':
    case 'STRING':
      return value.v;
    case 'BOOLEAN':
      return value.v ? 'TRUE' : 'FALSE';
    case 'DATE':
      return `${pad2(value.day)}/${pad2(value.month)}/${String(value.year).padStart(4, '0')}`;
    case 'ENUM':
      return value.name;
    case 'SET':
      return `{${value.members.map(formatValue).join(',')}}`;
    default:
      return valueTypeName(value);
  }
}

/** Rendering used by the debugger's variables panel, which quotes text. */
export function inspectValue(value: PValue | undefined): string {
  if (value === undefined) return '<no value>';
  switch (value.t) {
    case 'STRING':
      return JSON.stringify(value.v);
    case 'CHAR':
      return `'${value.v}'`;
    case 'ARRAY':
      return typeName(typeOfValue(value));
    case 'RECORD':
      return value.typeName;
    case 'OBJECT':
      return value.obj.className;
    case 'POINTER':
      return value.cell === null ? '^ -> <null>' : `^ -> ${value.cell.name}`;
    default:
      return formatValue(value);
  }
}

export function isComposite(value: PValue): boolean {
  return value.t === 'ARRAY' || value.t === 'RECORD' || value.t === 'OBJECT' || value.t === 'SET';
}

/**
 * May `value` be stored in a cell declared as `declared`?
 * See BUILD_GUIDE.md section 11.2 for the rule table.
 */
export function assignable(declared: PType, value: PValue): boolean {
  if (declared.k === 'REAL' && value.t === 'INTEGER') return true;
  if (declared.k === 'CLASS' && value.t === 'OBJECT') return true; // subclassing checked by caller
  // A `^X` expression knows what it points at but not which named pointer type
  // it is being stored into, so pointers match on their target type.
  if (declared.k === 'POINTER' && value.t === 'POINTER') {
    return sameType(declared.target, value.target);
  }
  if (declared.k === 'SET' && value.t === 'SET') {
    return value.typeName === '' || value.typeName === declared.name;
  }
  return sameType(declared, typeOfValue(value));
}

/** Applies the widening and naming that `assignable` permits. */
export function coerceForStore(declared: PType, value: PValue): PValue {
  if (declared.k === 'REAL' && value.t === 'INTEGER') return real(value.v);
  if (declared.k === 'POINTER' && value.t === 'POINTER' && value.typeName !== declared.name) {
    return { ...value, typeName: declared.name };
  }
  return value;
}

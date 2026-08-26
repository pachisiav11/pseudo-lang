export interface Bound {
  lower: number;
  upper: number;
}

export type PType =
  | { k: 'INTEGER' }
  | { k: 'REAL' }
  | { k: 'CHAR' }
  | { k: 'STRING' }
  | { k: 'BOOLEAN' }
  | { k: 'DATE' }
  | { k: 'ARRAY'; dims: Bound[]; element: PType }
  | { k: 'RECORD'; name: string }
  | { k: 'ENUM'; name: string }
  | { k: 'SET'; name: string; base: PType }
  | { k: 'POINTER'; name: string; target: PType }
  | { k: 'CLASS'; name: string };

export const INTEGER: PType = { k: 'INTEGER' };
export const REAL: PType = { k: 'REAL' };
export const CHAR: PType = { k: 'CHAR' };
export const STRING: PType = { k: 'STRING' };
export const BOOLEAN: PType = { k: 'BOOLEAN' };
export const DATE: PType = { k: 'DATE' };

export function typeName(t: PType): string {
  switch (t.k) {
    case 'ARRAY': {
      const dims = t.dims.map((d) => `${d.lower}:${d.upper}`).join(',');
      return `ARRAY[${dims}] OF ${typeName(t.element)}`;
    }
    case 'RECORD':
    case 'ENUM':
    case 'SET':
    case 'POINTER':
    case 'CLASS':
      return t.name;
    default:
      return t.k;
  }
}

export function sameType(a: PType, b: PType): boolean {
  if (a.k !== b.k) return false;
  switch (a.k) {
    case 'ARRAY': {
      const other = b as Extract<PType, { k: 'ARRAY' }>;
      if (a.dims.length !== other.dims.length) return false;
      for (let i = 0; i < a.dims.length; i += 1) {
        const x = a.dims[i];
        const y = other.dims[i];
        if (x === undefined || y === undefined) return false;
        if (x.lower !== y.lower || x.upper !== y.upper) return false;
      }
      return sameType(a.element, other.element);
    }
    case 'RECORD':
    case 'ENUM':
    case 'SET':
    case 'POINTER':
    case 'CLASS':
      return a.name === (b as { name: string }).name;
    default:
      return true;
  }
}

export function isNumeric(t: PType): boolean {
  return t.k === 'INTEGER' || t.k === 'REAL';
}

/** REAL wins over INTEGER in mixed arithmetic. */
export function commonNumeric(a: PType, b: PType): PType {
  return a.k === 'REAL' || b.k === 'REAL' ? REAL : INTEGER;
}

export function elementCount(dims: Bound[]): number {
  return dims.reduce((n, d) => n * (d.upper - d.lower + 1), 1);
}

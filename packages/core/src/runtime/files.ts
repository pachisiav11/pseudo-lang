import type { FileMode } from '../parser/ast';
import type { PValue } from './value';

export interface OpenFile {
  /** The identifier the program uses, e.g. "FileA.txt". */
  name: string;
  /** The resolved path on disk. */
  path: string;
  mode: FileMode;

  // READ
  lines?: string[];
  cursor?: number;

  // WRITE and APPEND
  pending?: string[];

  // RANDOM
  buffer?: Uint8Array;
  recordPointer?: number;
}

/**
 * The guide describes random files as fixed-length records with a movable
 * pointer, but defines no on-disk format, so this one is ours.
 *
 * Slot n (1-based, matching SEEK) occupies bytes [(n-1)*size, n*size). Each
 * slot holds a UTF-8 JSON encoding of the record, right-padded with spaces. An
 * all-space slot is empty. The format is deliberately human-readable; it is not
 * compatible with any other tool, because no interchange format exists.
 */
export const EMPTY_BYTE = 0x20;

export function slotBytes(buffer: Uint8Array, index: number, size: number): Uint8Array | null {
  const start = (index - 1) * size;
  if (start + size > buffer.length) return null;
  return buffer.subarray(start, start + size);
}

export function isEmptySlot(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === EMPTY_BYTE);
}

export function growTo(buffer: Uint8Array, bytes: number): Uint8Array {
  if (buffer.length >= bytes) return buffer;
  const grown = new Uint8Array(bytes).fill(EMPTY_BYTE);
  grown.set(buffer);
  return grown;
}

export interface StoredRecord {
  __type: string;
  f: Record<string, unknown>;
}

/** Turns a record value into the JSON stored in a slot. */
export function encodeRecord(value: Extract<PValue, { t: 'RECORD' }>): string {
  const f: Record<string, unknown> = {};
  for (const cell of value.fields.values()) {
    f[cell.name] = encodeScalar(cell.value);
  }
  return JSON.stringify({ __type: value.typeName, f } satisfies StoredRecord);
}

function encodeScalar(value: PValue | undefined): unknown {
  if (value === undefined) return null;
  switch (value.t) {
    case 'INTEGER':
    case 'REAL':
      return value.v;
    case 'CHAR':
    case 'STRING':
      return value.v;
    case 'BOOLEAN':
      return value.v;
    case 'DATE':
      return { __date: [value.day, value.month, value.year] };
    case 'ENUM':
      return { __enum: value.name, ordinal: value.ordinal };
    default:
      return null;
  }
}

export function decodeScalar(raw: unknown): PValue | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'number') return { t: 'REAL', v: raw };
  if (typeof raw === 'string') return { t: 'STRING', v: raw };
  if (typeof raw === 'boolean') return { t: 'BOOLEAN', v: raw };
  if (typeof raw === 'object' && '__date' in raw) {
    const parts = (raw as { __date: number[] }).__date;
    return { t: 'DATE', day: parts[0] ?? 1, month: parts[1] ?? 1, year: parts[2] ?? 1900 };
  }
  return undefined;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeSlot(json: string, size: number): Uint8Array | null {
  const bytes = encoder.encode(json);
  if (bytes.length > size) return null;
  const slot = new Uint8Array(size).fill(EMPTY_BYTE);
  slot.set(bytes);
  return slot;
}

export function decodeSlot(bytes: Uint8Array): string {
  return decoder.decode(bytes).trimEnd();
}

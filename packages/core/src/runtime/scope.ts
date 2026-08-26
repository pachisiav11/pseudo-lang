import { Cell } from './cell';
import type { PType } from './types';

export type ScopeKind = 'global' | 'local' | 'object';

/**
 * Identifiers are case-insensitive (guide section 2.3), so the map keys on the
 * lower-cased name while the Cell keeps the spelling from the declaration.
 */
export class Scope {
  private readonly cells = new Map<string, Cell>();

  constructor(
    readonly parent: Scope | null,
    readonly kind: ScopeKind,
  ) {}

  own(name: string): Cell | undefined {
    return this.cells.get(name.toLowerCase());
  }

  lookup(name: string): Cell | undefined {
    const key = name.toLowerCase();
    for (let s: Scope | null = this; s !== null; s = s.parent) {
      const found = s.cells.get(key);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  define(name: string, type: PType, isConstant = false): Cell {
    const cell = new Cell(type, undefined, name, isConstant);
    this.cells.set(name.toLowerCase(), cell);
    return cell;
  }

  bind(name: string, cell: Cell): void {
    this.cells.set(name.toLowerCase(), cell);
  }

  /** Declaration order, for the debugger's variables panel. */
  entries(): [string, Cell][] {
    return [...this.cells.values()].map((c) => [c.name, c]);
  }

  /** The nearest enclosing global scope. */
  global(): Scope {
    let s: Scope = this;
    while (s.parent !== null) s = s.parent;
    return s;
  }
}

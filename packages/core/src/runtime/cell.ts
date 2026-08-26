import type { PType } from './types';
import type { PValue } from './value';

/**
 * One storage location.
 *
 * Everything assignable is a Cell, which is what makes BYREF parameters and
 * pointers work: both are simply a second reference to an existing Cell.
 *
 * `value === undefined` means declared but never assigned. Cells are
 * deliberately not zero-initialised — the guide promises no default, and
 * catching the omission is more useful than hiding it.
 */
export class Cell {
  constructor(
    public declared: PType,
    public value: PValue | undefined,
    /** The identifier as its author spelled it, for messages and the debugger. */
    readonly name: string,
    readonly isConstant = false,
  ) {}
}

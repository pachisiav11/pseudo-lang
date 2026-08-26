/**
 * The diagnostic catalogue.
 *
 * E1xxx lexical, E2xxx syntax, E3xxx runtime (including type errors, because
 * typing is checked at runtime), W1xxx warnings.
 */
export const DIAGNOSTICS = {
  // ---- lexical ----
  E1001: 'unexpected character',
  E1010: 'invalid calendar date',
  E1011: 'malformed real literal',
  E1012: 'unterminated string',
  E1013: 'character literal must contain exactly one character',
  E1014: 'identifier starts with a digit',
  E1015: 'accented letters are not allowed in identifiers',

  // ---- syntax ----
  E2001: '`=` cannot be used to assign a value',
  E2002: 'expected a statement',
  E2003: 'reserved keyword used as an identifier',
  E2004: 'expected end of line',
  E2010: 'keywords must be written in upper case',
  E2011: 'block is never closed',
  E2012: 'unexpected token',
  E2020: 'subprograms cannot be nested',
  E2030: '`NEXT` identifier does not match the `FOR`',
  E2040: 'case label must be a literal or a constant',
  E2041: '`OTHERWISE` must be the last case',
  E2050: '`^` can only take the address of a variable',
  E2060: 'relational operators cannot be chained',
  E2070: 'invalid assignment target',
  E2080: '`RETURN` cannot be used inside a procedure',
  E2081: 'function parameters cannot be passed `BYREF`',
  E2082: '`CALL` cannot be used with a function',
  E2083: 'procedures must be called with `CALL`',
  E2084: 'expected a type',
  E2085: 'an array has one or two dimensions',

  // ---- runtime ----
  E3001: 'variable is used before it is given a value',
  E3002: 'variable is not declared',
  E3003: 'duplicate declaration',
  E3004: 'assignment to a constant',
  E3010: '`DIV` and `MOD` require whole numbers',
  E3011: 'division by zero',
  E3012: 'type mismatch in assignment',
  E3013: 'comparison between incompatible types',
  E3014: 'operator cannot be applied to these types',
  E3020: 'call depth exceeded',
  E3030: '`FOR` loop bounds must be whole numbers',
  E3031: '`STEP` cannot be zero',
  E3040: '`CASE` label does not match the type of the selector',
  E3050: 'cannot output a composite value',
  E3051: 'input could not be converted',
  E3052: 'unexpected end of input',
  E3060: 'set operation is not defined in the 9618 pseudocode guide',
  E3061: 'unknown type',
  E3070: 'dereference of a pointer that has no target',
  E3071: 'pointer target type mismatch',
  E3072: 'value is not a record or object',
  E3073: 'unknown field',
  E3074: 'value is not a pointer',
  E3080: 'array shape mismatch in assignment',
  E3081: 'record type mismatch in assignment',
  E3082: 'array index out of bounds',
  E3083: 'wrong number of array indices',
  E3084: 'value is not an array',
  E3090: 'unknown function',
  E3091: 'string position out of range',
  E3092: 'unknown subprogram',
  E3093: 'wrong number of arguments',
  E3094: '`BYREF` argument must be a variable',
  E3095: 'function ended without `RETURN`',
  E3096: 'argument type mismatch',
  E3097: '`RAND` argument must be positive',
  E3098: 'condition must be a BOOLEAN',
  E3100: 'access to a PRIVATE member',
  E3101: 'unknown class',
  E3102: 'class has no NEW method',
  E3103: '`SUPER` can only be used inside a class',
  E3104: 'class has no parent class',
  E3105: 'a procedure does not return a value',
  E3106: 'a function call is not a statement',
  E3110: 'file is not open for reading',
  E3111: 'file identifier must be a STRING',
  E3112: 'file does not exist',
  E3113: 'file is already open',
  E3114: '`READFILE` target must be a STRING',
  E3115: 'read past the end of the file',
  E3116: 'file is not open',
  E3117: 'record is too large for the record size',
  E3118: 'record slot is empty',
  E3119: 'record type does not match the stored record',
  E3120: 'no record pointer has been set',

  // ---- warnings ----
  W1001: 'file left open at the end of the program',
  W1002: 'variable is declared but never used',
  W1003: 'identifier differs from an existing one only by case',
} as const;

export type DiagCode = keyof typeof DIAGNOSTICS;

export function summaryOf(code: DiagCode): string {
  return DIAGNOSTICS[code];
}

export function isWarning(code: DiagCode): boolean {
  return code.startsWith('W');
}

/**
 * Every reserved word, taken from the index of the Cambridge 9618 pseudocode
 * guide plus the words used in its body text. All are upper case; the lexer
 * matches them case-sensitively so a lower-case `if` is deliberately not a
 * keyword.
 */
export const KEYWORDS: ReadonlySet<string> = new Set([
  'AND',
  'APPEND',
  'ARRAY',
  'BOOLEAN',
  'BYREF',
  'BYVAL',
  'CALL',
  'CASE',
  'CHAR',
  'CLASS',
  'CLOSEFILE',
  'CONSTANT',
  'DATE',
  'DECLARE',
  'DEFINE',
  'DIV',
  'ELSE',
  'ENDCASE',
  'ENDCLASS',
  'ENDFUNCTION',
  'ENDIF',
  'ENDPROCEDURE',
  'ENDTYPE',
  'ENDWHILE',
  'EOF',
  'FALSE',
  'FOR',
  'FUNCTION',
  'GETRECORD',
  'IF',
  'INHERITS',
  'INPUT',
  'INT',
  'INTEGER',
  'LCASE',
  'LENGTH',
  'MID',
  'MOD',
  'NEW',
  'NEXT',
  'NOT',
  'OF',
  'OPENFILE',
  'OR',
  'OTHERWISE',
  'OUTPUT',
  'PRIVATE',
  'PROCEDURE',
  'PUBLIC',
  'PUTRECORD',
  'RAND',
  'RANDOM',
  'READ',
  'READFILE',
  'REAL',
  'REPEAT',
  'RETURN',
  'RETURNS',
  'RIGHT',
  'SEEK',
  'SET',
  'STEP',
  'STRING',
  'SUPER',
  'THEN',
  'TO',
  'TRUE',
  'TYPE',
  'UCASE',
  'UNTIL',
  'WHILE',
  'WRITE',
  'WRITEFILE',
]);

/** Keywords that name a built-in data type in a `DECLARE`. */
export const TYPE_KEYWORDS: ReadonlySet<string> = new Set([
  'INTEGER',
  'REAL',
  'CHAR',
  'STRING',
  'BOOLEAN',
  'DATE',
  'ARRAY',
]);

/** Keywords that close a block, or open the next arm of one. */
export const BLOCK_END_KEYWORDS: ReadonlySet<string> = new Set([
  'ENDIF',
  'ELSE',
  'ENDCASE',
  'OTHERWISE',
  'ENDWHILE',
  'UNTIL',
  'NEXT',
  'ENDPROCEDURE',
  'ENDFUNCTION',
  'ENDTYPE',
  'ENDCLASS',
]);

/** Names of the eight functions defined by the guide. */
export const BUILTIN_NAMES: ReadonlySet<string> = new Set([
  'RIGHT',
  'LENGTH',
  'MID',
  'LCASE',
  'UCASE',
  'INT',
  'RAND',
  'EOF',
]);

export function isKeyword(text: string): boolean {
  return KEYWORDS.has(text);
}

/**
 * True when the text is a keyword written in the wrong case, e.g. `if` or
 * `EndIf`. Used to turn a confusing parse failure into a precise message.
 */
export function isMiscasedKeyword(text: string): string | null {
  const upper = text.toUpperCase();
  if (text !== upper && KEYWORDS.has(upper)) return upper;
  return null;
}

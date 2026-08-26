import type { Span } from '../diagnostics/error';

export type TokenKind =
  // literals
  | 'INT_LIT'
  | 'REAL_LIT'
  | 'STRING_LIT'
  | 'CHAR_LIT'
  | 'DATE_LIT'
  // words
  | 'IDENT'
  | 'KEYWORD'
  // operators
  | 'ASSIGN'
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'AMP'
  | 'CARET'
  | 'EQ'
  | 'NEQ'
  | 'LT'
  | 'LTE'
  | 'GT'
  | 'GTE'
  // punctuation
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'COMMA'
  | 'COLON'
  | 'DOT'
  // structure
  | 'NEWLINE'
  | 'EOF';

export interface DateValue {
  day: number;
  month: number;
  year: number;
}

export type LiteralValue = number | string | DateValue;

export interface Token {
  kind: TokenKind;
  text: string;
  span: Span;
  value?: LiteralValue;
}

/** Human-readable name used in "expected X, found Y" messages. */
export function describeToken(tok: Token): string {
  switch (tok.kind) {
    case 'EOF':
      return 'end of file';
    case 'NEWLINE':
      return 'end of line';
    case 'IDENT':
      return `identifier \`${tok.text}\``;
    case 'KEYWORD':
      return `keyword \`${tok.text}\``;
    case 'STRING_LIT':
      return `string ${tok.text}`;
    case 'CHAR_LIT':
      return `character ${tok.text}`;
    default:
      return `\`${tok.text}\``;
  }
}

/**
 * Tokens after which a line break is a continuation rather than the end of a
 * statement. This is what lets the guide's wrapped parameter lists parse.
 */
export const CONTINUATION_KINDS: ReadonlySet<TokenKind> = new Set<TokenKind>([
  'COMMA',
  'LPAREN',
  'LBRACKET',
  'ASSIGN',
  'PLUS',
  'MINUS',
  'STAR',
  'SLASH',
  'AMP',
  'EQ',
  'NEQ',
  'LT',
  'LTE',
  'GT',
  'GTE',
]);

export const CONTINUATION_KEYWORDS: ReadonlySet<string> = new Set(['AND', 'OR', 'NOT', 'DIV', 'MOD']);

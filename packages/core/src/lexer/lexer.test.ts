import { describe, expect, it } from 'vitest';
import { DiagnosticSink, SourceFile } from '../diagnostics/error';
import { lex } from './lexer';
import type { Token, TokenKind } from './token';

function run(src: string): { tokens: Token[]; sink: DiagnosticSink } {
  return lex(new SourceFile('test.pseudo', src));
}

function kinds(src: string): TokenKind[] {
  return run(src).tokens.map((t) => t.kind);
}

function codes(src: string): string[] {
  return run(src).sink.errors.map((e) => e.code);
}

describe('lexer: the M1 acceptance test', () => {
  it('lexes the milestone example', () => {
    const src = ['// a comment', 'DECLARE Total : INTEGER', "Total <- 4.0 + 'x'"].join('\n');
    expect(kinds(src)).toEqual([
      'KEYWORD',
      'IDENT',
      'COLON',
      'KEYWORD',
      'NEWLINE',
      'IDENT',
      'ASSIGN',
      'REAL_LIT',
      'PLUS',
      'CHAR_LIT',
      'NEWLINE',
      'EOF',
    ]);
    expect(codes(src)).toEqual([]);
  });
});

describe('lexer: spans', () => {
  it('reports 1-based line and column', () => {
    const { tokens } = run('DECLARE X\nX <- 1');
    expect(tokens[0]?.span).toMatchObject({ line: 1, col: 1, endCol: 8 });
    expect(tokens[1]?.span).toMatchObject({ line: 1, col: 9, endCol: 10 });
    expect(tokens[3]?.span).toMatchObject({ line: 2, col: 1 });
    expect(tokens[5]?.span).toMatchObject({ line: 2, col: 6 });
  });

  it('treats \\r\\n as one line break', () => {
    const { tokens } = run('A <- 1\r\nB <- 2');
    const b = tokens.find((t) => t.text === 'B');
    expect(b?.span.line).toBe(2);
    expect(b?.span.col).toBe(1);
  });
});

describe('lexer: assignment', () => {
  it('accepts both the arrow and the digraph', () => {
    expect(kinds('A <- 1')).toEqual(['IDENT', 'ASSIGN', 'INT_LIT', 'NEWLINE', 'EOF']);
    expect(kinds('A ← 1')).toEqual(['IDENT', 'ASSIGN', 'INT_LIT', 'NEWLINE', 'EOF']);
  });

  it('keeps = as comparison', () => {
    expect(kinds('A = 1')).toEqual(['IDENT', 'EQ', 'INT_LIT', 'NEWLINE', 'EOF']);
  });

  it('distinguishes <- <= <> and <', () => {
    expect(kinds('a<-b<=c<>d<e')).toEqual([
      'IDENT',
      'ASSIGN',
      'IDENT',
      'LTE',
      'IDENT',
      'NEQ',
      'IDENT',
      'LT',
      'IDENT',
      'NEWLINE',
      'EOF',
    ]);
  });
});

describe('lexer: numbers and dates', () => {
  it('lexes an integer and a real', () => {
    const { tokens } = run('5 4.7');
    expect(tokens[0]).toMatchObject({ kind: 'INT_LIT', value: 5 });
    expect(tokens[1]).toMatchObject({ kind: 'REAL_LIT', value: 4.7 });
  });

  it('lexes a padded dd/mm/yyyy as a date', () => {
    const { tokens, sink } = run('D <- 02/01/2005');
    expect(tokens[2]).toMatchObject({ kind: 'DATE_LIT', value: { day: 2, month: 1, year: 2005 } });
    expect(sink.errors).toEqual([]);
  });

  it('lexes spaced or unpadded slashes as division', () => {
    expect(kinds('X <- 12 / 5 / 2024')).toContain('SLASH');
    expect(kinds('X <- 365/12')).toEqual([
      'IDENT',
      'ASSIGN',
      'INT_LIT',
      'SLASH',
      'INT_LIT',
      'NEWLINE',
      'EOF',
    ]);
  });

  it('rejects an impossible date', () => {
    expect(codes('D <- 31/02/2005')).toEqual(['E1010']);
  });

  it('rejects a real literal missing a digit', () => {
    expect(codes('X <- 4.')).toEqual(['E1011']);
    expect(codes('X <- .7')).toEqual(['E1011']);
  });

  it('rejects an identifier starting with a digit', () => {
    expect(codes('3abc <- 1')).toEqual(['E1014']);
  });
});

describe('lexer: strings and characters', () => {
  it('lexes an empty string', () => {
    const { tokens, sink } = run('X <- ""');
    expect(tokens[2]).toMatchObject({ kind: 'STRING_LIT', value: '' });
    expect(sink.errors).toEqual([]);
  });

  it('rejects an unterminated string', () => {
    expect(codes('X <- "oops')).toEqual(['E1012']);
  });

  it('rejects a character literal that is not one character', () => {
    expect(codes("X <- 'ab'")).toEqual(['E1013']);
    expect(codes("X <- ''")).toEqual(['E1013']);
  });
});

describe('lexer: words', () => {
  it('recognises upper-case keywords only', () => {
    expect(run('IF').tokens[0]?.kind).toBe('KEYWORD');
    expect(run('if').tokens[0]?.kind).toBe('IDENT');
    expect(run('EndIf').tokens[0]?.kind).toBe('IDENT');
  });

  it('rejects accented letters', () => {
    expect(codes('Café <- 1')).toEqual(['E1015']);
  });
});

describe('lexer: line structure', () => {
  it('collapses blank lines and drops leading ones', () => {
    expect(kinds('\n\n\nA <- 1\n\n\nB <- 2\n\n')).toEqual([
      'IDENT',
      'ASSIGN',
      'INT_LIT',
      'NEWLINE',
      'IDENT',
      'ASSIGN',
      'INT_LIT',
      'NEWLINE',
      'EOF',
    ]);
  });

  it('adds a final newline when the file does not end with one', () => {
    expect(kinds('A <- 1')).toEqual(['IDENT', 'ASSIGN', 'INT_LIT', 'NEWLINE', 'EOF']);
  });

  it('continues a line that ends with a comma', () => {
    const src = 'FUNCTION Max(Number1 : INTEGER,\n   Number2 : INTEGER) RETURNS INTEGER';
    expect(kinds(src).filter((k) => k === 'NEWLINE')).toHaveLength(1);
  });

  it('continues a line that ends with an operator', () => {
    expect(kinds('X <- 1 +\n   2').filter((k) => k === 'NEWLINE')).toHaveLength(1);
  });

  it('drops comments but keeps the line break', () => {
    expect(kinds('A <- 1 // set it\nB <- 2')).toEqual([
      'IDENT',
      'ASSIGN',
      'INT_LIT',
      'NEWLINE',
      'IDENT',
      'ASSIGN',
      'INT_LIT',
      'NEWLINE',
      'EOF',
    ]);
  });
});

describe('lexer: unexpected input', () => {
  it('reports an unknown character and carries on', () => {
    const { sink, tokens } = run('A <- 1 $ B');
    expect(sink.errors.map((e) => e.code)).toEqual(['E1001']);
    expect(tokens.at(-1)?.kind).toBe('EOF');
  });
});

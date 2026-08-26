import { DiagnosticSink, PseudoError, type Span, mergeSpans } from '../diagnostics/error';
import type { DiagCode } from '../diagnostics/codes';
import { BLOCK_END_KEYWORDS, isMiscasedKeyword } from '../lexer/keywords';
import { type Token, type TokenKind, describeToken } from '../lexer/token';
import {
  type ArrayDim,
  type BinOp,
  type CaseClause,
  type ClassDeclaration,
  type ClassField,
  type Expr,
  type FileMode,
  type FileOp,
  type LValue,
  type Param,
  type PrimitiveName,
  type Program,
  type RecordField,
  type Stmt,
  type SubprogramDecl,
  type TypeDeclaration,
  type TypeRef,
  isLValue,
} from './ast';

const PRIMITIVE_NAMES = new Set<string>(['INTEGER', 'REAL', 'CHAR', 'STRING', 'BOOLEAN', 'DATE']);

/** Precedence levels; higher binds tighter. See BUILD_GUIDE.md section 8. */
const BINARY_PRECEDENCE: Record<BinOp, number> = {
  MUL: 6,
  DIV_REAL: 6,
  DIV_INT: 6,
  MOD: 6,
  ADD: 5,
  SUB: 5,
  CONCAT: 5,
  EQ: 4,
  NEQ: 4,
  LT: 4,
  LTE: 4,
  GT: 4,
  GTE: 4,
  // NOT sits at 3, between the relational operators and AND, so that
  // `NOT X = Y` reads as `NOT (X = Y)`.
  AND: 2,
  OR: 1,
};

const RELATIONAL: ReadonlySet<BinOp> = new Set<BinOp>(['EQ', 'NEQ', 'LT', 'LTE', 'GT', 'GTE']);

/** Thrown to abandon the current statement and resynchronise at the next line. */
class StatementError extends Error {}

interface OpenBlock {
  keyword: string;
  expected: string;
  span: Span;
}

export class Parser {
  private pos = 0;
  private readonly openBlocks: OpenBlock[] = [];
  private syntaxErrors = 0;
  private inSubprogram = false;

  constructor(
    private readonly tokens: Token[],
    private readonly sink: DiagnosticSink,
  ) {}

  // -------------------------------------------------------------- utilities

  private peek(offset = 0): Token {
    const tok = this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
    if (tok === undefined) throw new Error('token stream is empty');
    return tok;
  }

  private get current(): Token {
    return this.peek();
  }

  private advance(): Token {
    const tok = this.current;
    if (tok.kind !== 'EOF') this.pos += 1;
    return tok;
  }

  private check(kind: TokenKind, text?: string): boolean {
    const tok = this.current;
    return tok.kind === kind && (text === undefined || tok.text === text);
  }

  private checkKeyword(...texts: string[]): boolean {
    const tok = this.current;
    return tok.kind === 'KEYWORD' && texts.includes(tok.text);
  }

  private match(kind: TokenKind, text?: string): boolean {
    if (!this.check(kind, text)) return false;
    this.advance();
    return true;
  }

  private matchKeyword(...texts: string[]): string | null {
    if (!this.checkKeyword(...texts)) return null;
    return this.advance().text;
  }

  private fail(code: DiagCode, span: Span, init: Parameters<DiagnosticSink['report']>[2] = {}): never {
    this.sink.report(code, span, init);
    this.syntaxErrors += 1;
    throw new StatementError();
  }

  private expect(kind: TokenKind, text: string, code: DiagCode = 'E2012'): Token {
    if (this.check(kind, text)) return this.advance();

    const tok = this.current;
    const miscased = tok.kind === 'IDENT' ? isMiscasedKeyword(tok.text) : null;
    if (miscased === text) {
      this.fail('E2010', tok.span, {
        message: `\`${tok.text}\` is not a keyword`,
        label: 'must be upper case',
        help: `Pseudocode keywords are written in upper case. Write \`${text}\`.`,
      });
    }
    this.fail(code, tok.span, {
      message: `expected \`${text}\`, found ${describeToken(tok)}`,
      label: `expected \`${text}\``,
    });
  }

  private expectIdent(): Token {
    const tok = this.current;
    if (tok.kind === 'IDENT') return this.advance();
    if (tok.kind === 'KEYWORD') {
      this.fail('E2003', tok.span, {
        message: `\`${tok.text}\` is a reserved keyword and cannot be used as an identifier`,
        label: 'reserved keyword',
      });
    }
    this.fail('E2012', tok.span, {
      message: `expected an identifier, found ${describeToken(tok)}`,
      label: 'expected an identifier',
    });
  }

  /**
   * Constructors are called NEW, which is also a keyword, so the subprogram
   * name and member name positions accept it.
   */
  private expectMemberName(): Token {
    if (this.checkKeyword('NEW')) return this.advance();
    return this.expectIdent();
  }

  private endOfLine(): void {
    if (this.match('NEWLINE')) return;
    if (this.check('EOF')) return;
    const tok = this.current;
    this.fail('E2004', tok.span, {
      message: `unexpected ${describeToken(tok)} after the end of the statement`,
      label: 'expected the end of the line',
    });
  }

  private skipNewlines(): void {
    while (this.match('NEWLINE')) {
      // blank lines between statements
    }
  }

  private atBlockEnd(): boolean {
    const tok = this.current;
    if (tok.kind === 'EOF') return true;
    return tok.kind === 'KEYWORD' && BLOCK_END_KEYWORDS.has(tok.text);
  }

  /** Skips to the start of the next line after a syntax error. */
  private synchronise(): void {
    while (!this.check('EOF') && !this.check('NEWLINE')) this.advance();
    this.match('NEWLINE');
  }

  // ---------------------------------------------------------------- program

  parseProgram(): Program {
    const body = this.parseStatementList();
    if (!this.check('EOF')) {
      const tok = this.current;
      const open = this.openBlocks.at(-1);
      if (open !== undefined) {
        this.sink.report('E2011', open.span, {
          message: `\`${open.keyword}\` on line ${open.span.line} is never closed`,
          label: `opened here`,
          help: `Expected \`${open.expected}\` before ${describeToken(tok)}.`,
        });
      } else {
        this.sink.report('E2012', tok.span, {
          message: `unexpected ${describeToken(tok)}`,
          label: 'not valid here',
        });
      }
    }
    return { body };
  }

  private parseStatementList(): Stmt[] {
    const body: Stmt[] = [];
    this.skipNewlines();
    while (!this.atBlockEnd()) {
      if (this.syntaxErrors >= 25) {
        this.sink.report('E2012', this.current.span, { message: 'too many syntax errors' });
        break;
      }
      const before = this.pos;
      try {
        body.push(this.parseStatement());
      } catch (err) {
        if (!(err instanceof StatementError)) throw err;
        this.synchronise();
      }
      if (this.pos === before) this.advance(); // guarantee progress
      this.skipNewlines();
    }
    return body;
  }

  /** Parses a block body and the keyword that closes it. */
  private parseBlock(openKeyword: string, openSpan: Span, ...closers: string[]): Stmt[] {
    this.openBlocks.push({ keyword: openKeyword, expected: closers[0] ?? 'END', span: openSpan });
    const body = this.parseStatementList();
    this.openBlocks.pop();
    if (!this.checkKeyword(...closers)) {
      this.sink.report('E2011', openSpan, {
        message: `\`${openKeyword}\` on line ${openSpan.line} is never closed`,
        label: 'opened here',
        help: `Expected \`${closers.join('` or `')}\` before ${describeToken(this.current)}.`,
      });
      this.syntaxErrors += 1;
      throw new StatementError();
    }
    return body;
  }

  // ------------------------------------------------------------- statements

  private parseStatement(): Stmt {
    const tok = this.current;

    if (tok.kind === 'KEYWORD') {
      switch (tok.text) {
        case 'DECLARE':
          return this.parseDeclare();
        case 'CONSTANT':
          return this.parseConstant();
        case 'INPUT':
          return this.parseInput();
        case 'OUTPUT':
          return this.parseOutput();
        case 'IF':
          return this.parseIf();
        case 'CASE':
          return this.parseCase();
        case 'FOR':
          return this.parseFor();
        case 'REPEAT':
          return this.parseRepeat();
        case 'WHILE':
          return this.parseWhile();
        case 'PROCEDURE':
          return this.parseSubprogram(false);
        case 'FUNCTION':
          return this.parseSubprogram(true);
        case 'CALL':
          return this.parseCall();
        case 'RETURN':
          return this.parseReturn();
        case 'TYPE':
          return this.parseTypeDecl();
        case 'DEFINE':
          return this.parseDefine();
        case 'OPENFILE':
        case 'READFILE':
        case 'WRITEFILE':
        case 'CLOSEFILE':
        case 'SEEK':
        case 'GETRECORD':
        case 'PUTRECORD':
          return this.parseFileStmt();
        case 'CLASS':
          return this.parseClass();
        case 'SUPER':
          // SUPER.NEW(...) and SUPER.Method(...) are complete statements.
          return this.parseAssignment();
        default:
          break;
      }
    }

    if (tok.kind === 'IDENT') {
      const miscased = isMiscasedKeyword(tok.text);
      // A statement can only start with an identifier when it is an assignment
      // or a method call, so a mis-cased keyword here is worth naming.
      if (miscased !== null && !this.startsAssignment()) {
        this.fail('E2010', tok.span, {
          message: `\`${tok.text}\` is not a keyword`,
          label: 'must be upper case',
          help: `Pseudocode keywords are written in upper case. Did you mean \`${miscased}\`?`,
        });
      }
      return this.parseAssignment();
    }

    this.fail('E2002', tok.span, {
      message: `expected a statement, found ${describeToken(tok)}`,
      label: 'not the start of a statement',
    });
  }

  private parseDeclare(): Stmt {
    const start = this.advance().span; // DECLARE
    const name = this.expectIdent();
    this.expect('COLON', ':');
    const typeRef = this.parseTypeRef();
    this.endOfLine();
    return { kind: 'Declare', name: name.text, typeRef, span: mergeSpans(start, typeRef.span) };
  }

  private parseConstant(): Stmt {
    const start = this.advance().span; // CONSTANT
    const name = this.expectIdent();
    this.expect('EQ', '=');
    const value = this.parseLiteralOnly('the value of a constant');
    this.endOfLine();
    return { kind: 'Constant', name: name.text, value, span: mergeSpans(start, value.span) };
  }

  private parseInput(): Stmt {
    const start = this.advance().span; // INPUT
    const target = this.parseLValue();
    this.endOfLine();
    return { kind: 'Input', target, span: mergeSpans(start, target.span) };
  }

  private parseOutput(): Stmt {
    const start = this.advance().span; // OUTPUT
    const values = [this.parseExpr()];
    while (this.match('COMMA')) values.push(this.parseExpr());
    this.endOfLine();
    const last = values.at(-1);
    return { kind: 'Output', values, span: mergeSpans(start, last?.span ?? start) };
  }

  /** Looks ahead for an `<-` (or `=`) before the end of the line. */
  private startsAssignment(): boolean {
    for (let i = 0; ; i += 1) {
      const tok = this.peek(i);
      if (tok.kind === 'NEWLINE' || tok.kind === 'EOF') return false;
      if (tok.kind === 'ASSIGN' || tok.kind === 'EQ') return true;
    }
  }

  private parseAssignment(): Stmt {
    const target = this.parsePostfix();

    // The guide writes method calls without CALL: `Player.SetAttempts(5)`.
    if (target.kind === 'MethodCall' && !this.check('ASSIGN')) {
      this.endOfLine();
      return {
        kind: 'MethodCallStmt',
        target: target.target,
        method: target.method,
        args: target.args,
        span: target.span,
      };
    }

    if (this.check('EQ')) {
      const eq = this.current;
      const line = this.tokenLineText(eq);
      this.fail('E2001', eq.span, {
        label: 'this is a comparison operator',
        help: `Assignment in 9618 pseudocode is written with a left arrow:\n${line.replace('=', '<-').trim()}`,
      });
    }

    if (!this.check('ASSIGN')) {
      this.fail('E2002', this.current.span, {
        message: `expected \`<-\` after \`${this.exprText(target)}\`, found ${describeToken(this.current)}`,
        label: 'expected an assignment',
      });
    }
    this.advance();

    if (!isLValue(target)) {
      this.fail('E2070', target.span, {
        label: 'cannot be assigned to',
        help: 'Only a variable, an array element, a record field or a\ndereferenced pointer can appear on the left of `<-`.',
      });
    }

    const value = this.parseExpr();
    this.endOfLine();
    return { kind: 'Assign', target, value, span: mergeSpans(target.span, value.span) };
  }

  // ----------------------------------------------------------- control flow

  private parseIf(): Stmt {
    const start = this.advance().span; // IF
    const cond = this.parseExpr();
    this.match('NEWLINE'); // the guide allows THEN on the next line
    this.expect('KEYWORD', 'THEN');
    this.endOfLine();

    const then = this.parseBlock('IF', start, 'ELSE', 'ENDIF');

    let otherwise: Stmt[] | undefined;
    if (this.matchKeyword('ELSE') !== null) {
      this.endOfLine();
      otherwise = this.parseBlock('ELSE', start, 'ENDIF');
    }

    const end = this.expect('KEYWORD', 'ENDIF');
    this.endOfLine();
    const stmt: Stmt = { kind: 'If', cond, then, span: mergeSpans(start, end.span) };
    return otherwise === undefined ? stmt : { ...stmt, otherwise };
  }

  private parseWhile(): Stmt {
    const start = this.advance().span; // WHILE
    const cond = this.parseExpr();
    this.endOfLine();
    const body = this.parseBlock('WHILE', start, 'ENDWHILE');
    const end = this.expect('KEYWORD', 'ENDWHILE');
    this.endOfLine();
    return { kind: 'While', cond, body, span: mergeSpans(start, end.span) };
  }

  private parseRepeat(): Stmt {
    const start = this.advance().span; // REPEAT
    this.endOfLine();
    const body = this.parseBlock('REPEAT', start, 'UNTIL');
    this.expect('KEYWORD', 'UNTIL');
    const until = this.parseExpr();
    this.endOfLine();
    return { kind: 'Repeat', body, until, span: mergeSpans(start, until.span) };
  }

  private parseFor(): Stmt {
    const start = this.advance().span; // FOR
    const varTok = this.expectIdent();

    if (this.check('EQ')) {
      this.fail('E2001', this.current.span, {
        label: 'this is a comparison operator',
        help: `A FOR loop assigns its start value with an arrow:\nFOR ${varTok.text} <- 1 TO 10`,
      });
    }
    this.expect('ASSIGN', '<-');

    const from = this.parseExpr();
    this.expect('KEYWORD', 'TO');
    const to = this.parseExpr();

    let step: Expr | undefined;
    if (this.matchKeyword('STEP') !== null) step = this.parseExpr();
    this.endOfLine();

    const body = this.parseBlock('FOR', start, 'NEXT');
    this.expect('KEYWORD', 'NEXT');
    const nextTok = this.expectIdent();
    if (nextTok.text.toLowerCase() !== varTok.text.toLowerCase()) {
      this.sink.report('E2030', nextTok.span, {
        message: `\`NEXT ${nextTok.text}\` does not match \`FOR ${varTok.text}\``,
        label: `expected \`${varTok.text}\``,
        help: `The FOR loop on line ${start.line} counts with \`${varTok.text}\`.`,
      });
      this.syntaxErrors += 1;
    }
    this.endOfLine();

    const stmt: Stmt = {
      kind: 'For',
      varName: varTok.text,
      from,
      to,
      body,
      span: mergeSpans(start, nextTok.span),
    };
    return step === undefined ? stmt : { ...stmt, step };
  }

  // ----------------------------------------------------------------- classes

  private parseClass(): Stmt {
    const start = this.advance().span; // CLASS
    const name = this.expectIdent();

    let inherits: string | undefined;
    if (this.matchKeyword('INHERITS') !== null) inherits = this.expectIdent().text;
    this.endOfLine();

    const fields: ClassField[] = [];
    const methods: SubprogramDecl[] = [];

    this.openBlocks.push({ keyword: 'CLASS', expected: 'ENDCLASS', span: start });
    this.skipNewlines();

    while (!this.check('EOF') && !this.checkKeyword('ENDCLASS')) {
      const before = this.pos;
      try {
        // The guide: members "can be assumed to be public unless otherwise
        // stated".
        const accessTok = this.matchKeyword('PUBLIC', 'PRIVATE');
        const access = accessTok === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';

        if (this.checkKeyword('PROCEDURE', 'FUNCTION')) {
          const isFunction = this.current.text === 'FUNCTION';
          const stmt = this.parseSubprogram(isFunction, access);
          methods.push(stmt.kind === 'ProcDecl' || stmt.kind === 'FuncDecl' ? stmt.decl : (() => {
            throw new StatementError();
          })());
        } else {
          // A field: `PRIVATE Name : STRING`, with no DECLARE keyword.
          const fieldName = this.expectIdent();
          this.expect('COLON', ':');
          const typeRef = this.parseTypeRef();
          this.endOfLine();
          fields.push({
            name: fieldName.text,
            typeRef,
            access,
            span: mergeSpans(fieldName.span, typeRef.span),
          });
        }
      } catch (err) {
        if (!(err instanceof StatementError)) throw err;
        this.synchronise();
      }
      if (this.pos === before) this.advance();
      this.skipNewlines();
    }

    this.openBlocks.pop();
    const end = this.expect('KEYWORD', 'ENDCLASS');
    this.endOfLine();

    const decl: ClassDeclaration = {
      name: name.text,
      fields,
      methods,
      span: mergeSpans(start, end.span),
    };
    if (inherits !== undefined) decl.inherits = inherits;
    return { kind: 'ClassDecl', decl, span: decl.span };
  }

  // ---------------------------------------------------------- file handling

  private parseFileStmt(): Stmt {
    const opTok = this.advance();
    const op = opTok.text as FileOp;
    const file = this.parseExpr();

    switch (op) {
      case 'OPENFILE': {
        this.expect('KEYWORD', 'FOR');
        const modeTok = this.current;
        const mode = this.matchKeyword('READ', 'WRITE', 'APPEND', 'RANDOM');
        if (mode === null) {
          this.fail('E2012', modeTok.span, {
            message: `expected a file mode, found ${describeToken(modeTok)}`,
            label: 'expected READ, WRITE, APPEND or RANDOM',
          });
        }
        this.endOfLine();
        return {
          kind: 'FileStmt',
          op,
          file,
          mode: mode as FileMode,
          span: mergeSpans(opTok.span, modeTok.span),
        };
      }

      case 'CLOSEFILE':
        this.endOfLine();
        return { kind: 'FileStmt', op, file, span: mergeSpans(opTok.span, file.span) };

      case 'READFILE':
      case 'GETRECORD': {
        this.expect('COMMA', ',');
        const target = this.parseLValue();
        this.endOfLine();
        return { kind: 'FileStmt', op, file, target, span: mergeSpans(opTok.span, target.span) };
      }

      case 'WRITEFILE':
      case 'PUTRECORD':
      case 'SEEK': {
        this.expect('COMMA', ',');
        const value = this.parseExpr();
        this.endOfLine();
        return { kind: 'FileStmt', op, file, value, span: mergeSpans(opTok.span, value.span) };
      }
    }
  }

  // ------------------------------------------------------ user-defined types

  private parseTypeDecl(): Stmt {
    const start = this.advance().span; // TYPE
    const name = this.expectIdent();

    if (this.match('EQ')) {
      // Non-composite forms, and the one-line SET form.
      if (this.check('LPAREN')) {
        this.advance();
        const values: string[] = [];
        if (!this.check('RPAREN')) {
          values.push(this.expectIdent().text);
          while (this.match('COMMA')) values.push(this.expectIdent().text);
        }
        const close = this.expect('RPAREN', ')');
        this.endOfLine();
        const decl: TypeDeclaration = {
          kind: 'Enum',
          name: name.text,
          values,
          span: mergeSpans(start, close.span),
        };
        return { kind: 'TypeDecl', decl, span: decl.span };
      }

      if (this.check('CARET')) {
        this.advance();
        const target = this.parseTypeRef();
        this.endOfLine();
        const decl: TypeDeclaration = {
          kind: 'Pointer',
          name: name.text,
          target,
          span: mergeSpans(start, target.span),
        };
        return { kind: 'TypeDecl', decl, span: decl.span };
      }

      if (this.checkKeyword('SET')) {
        this.advance();
        this.expect('KEYWORD', 'OF');
        const base = this.parseTypeRef();
        this.endOfLine();
        const decl: TypeDeclaration = {
          kind: 'Set',
          name: name.text,
          base,
          span: mergeSpans(start, base.span),
        };
        return { kind: 'TypeDecl', decl, span: decl.span };
      }

      this.fail('E2084', this.current.span, {
        message: `expected \`(\`, \`^\` or \`SET OF\` after \`TYPE ${name.text} =\`, found ${describeToken(this.current)}`,
        label: 'not a type definition',
        help: 'TYPE X = (a, b, c)      an enumerated type\nTYPE X = ^INTEGER       a pointer type\nTYPE X = SET OF CHAR    a set type',
      });
    }

    // Record form: TYPE <name> NL { DECLARE ... } ENDTYPE
    this.endOfLine();
    const fields: RecordField[] = [];
    this.openBlocks.push({ keyword: 'TYPE', expected: 'ENDTYPE', span: start });
    this.skipNewlines();
    while (!this.check('EOF') && !this.checkKeyword('ENDTYPE')) {
      const declareTok = this.expect('KEYWORD', 'DECLARE');
      const fieldName = this.expectIdent();
      this.expect('COLON', ':');
      const typeRef = this.parseTypeRef();
      this.endOfLine();
      fields.push({
        name: fieldName.text,
        typeRef,
        span: mergeSpans(declareTok.span, typeRef.span),
      });
      this.skipNewlines();
    }
    this.openBlocks.pop();
    const end = this.expect('KEYWORD', 'ENDTYPE');
    this.endOfLine();

    const decl: TypeDeclaration = {
      kind: 'Record',
      name: name.text,
      fields,
      span: mergeSpans(start, end.span),
    };
    return { kind: 'TypeDecl', decl, span: decl.span };
  }

  private parseDefine(): Stmt {
    const start = this.advance().span; // DEFINE
    const name = this.expectIdent();
    this.expect('LPAREN', '(');
    const values: Expr[] = [];
    if (!this.check('RPAREN')) {
      values.push(this.parseLiteralOnly('a set member'));
      while (this.match('COMMA')) values.push(this.parseLiteralOnly('a set member'));
    }
    this.expect('RPAREN', ')');
    this.expect('COLON', ':');
    const setType = this.expectIdent();
    this.endOfLine();
    return {
      kind: 'Define',
      name: name.text,
      values,
      setType: setType.text,
      span: mergeSpans(start, setType.span),
    };
  }

  // ------------------------------------------------------------ subprograms

  parseSubprogram(isFunction: boolean, access?: 'PUBLIC' | 'PRIVATE'): Stmt {
    const keyword = isFunction ? 'FUNCTION' : 'PROCEDURE';
    const closer = isFunction ? 'ENDFUNCTION' : 'ENDPROCEDURE';
    const start = this.advance().span;

    if (this.inSubprogram) {
      this.fail('E2020', start, {
        message: `a ${keyword} cannot be defined inside another subprogram`,
        label: 'nested definition',
        help: 'Close the enclosing subprogram first. Pseudocode subprograms are\nall defined at the top level.',
      });
    }

    const name = this.expectMemberName();
    const params = this.parseParamList(isFunction);

    let returns: TypeRef | undefined;
    if (isFunction) {
      this.expect('KEYWORD', 'RETURNS');
      returns = this.parseTypeRef();
    }
    this.endOfLine();

    this.inSubprogram = true;
    let body: Stmt[];
    try {
      body = this.parseBlock(keyword, start, closer);
    } finally {
      this.inSubprogram = false;
    }
    const end = this.expect('KEYWORD', closer);
    this.endOfLine();

    const decl: SubprogramDecl = {
      name: name.text,
      params,
      body,
      span: mergeSpans(start, end.span),
    };
    if (returns !== undefined) decl.returns = returns;
    if (access !== undefined) decl.access = access;

    return isFunction
      ? { kind: 'FuncDecl', decl, span: decl.span }
      : { kind: 'ProcDecl', decl, span: decl.span };
  }

  private parseParamList(isFunction: boolean): Param[] {
    this.expect('LPAREN', '(');
    const params: Param[] = [];
    // The guide: "If there are several parameters passed by the same method,
    // the BYVAL or BYREF keyword need not be repeated." So the mode is sticky.
    let byRef = false;

    if (!this.check('RPAREN')) {
      for (;;) {
        const mode = this.matchKeyword('BYVAL', 'BYREF');
        if (mode !== null) byRef = mode === 'BYREF';

        const name = this.expectIdent();
        if (byRef && isFunction) {
          this.sink.report('E2081', name.span, {
            message: `\`${name.text}\` cannot be passed BYREF because this is a FUNCTION`,
            label: 'BYREF parameter',
            help: 'The guide states that parameters should not be passed by\nreference to a function.',
          });
          this.syntaxErrors += 1;
        }
        this.expect('COLON', ':');
        const typeRef = this.parseTypeRef();
        params.push({ name: name.text, typeRef, byRef, span: mergeSpans(name.span, typeRef.span) });

        if (!this.match('COMMA')) break;
      }
    }

    this.expect('RPAREN', ')');
    return params;
  }

  private parseCall(): Stmt {
    const start = this.advance().span; // CALL
    const name = this.expectIdent();
    // The guide's own CASE example writes `CALL Beep` with no brackets.
    const args = this.check('LPAREN') ? this.parseArgList() : { args: [], span: name.span };
    this.endOfLine();
    return {
      kind: 'CallStmt',
      callee: name.text,
      args: args.args,
      span: mergeSpans(start, args.span),
    };
  }

  private parseReturn(): Stmt {
    const start = this.advance().span; // RETURN
    if (this.check('NEWLINE') || this.check('EOF')) {
      this.endOfLine();
      return { kind: 'Return', span: start };
    }
    const value = this.parseExpr();
    this.endOfLine();
    return { kind: 'Return', value, span: mergeSpans(start, value.span) };
  }

  private looksLikeCaseLabel(): boolean {
    const tok = this.current;
    const isLabelStart =
      tok.kind === 'INT_LIT' ||
      tok.kind === 'REAL_LIT' ||
      tok.kind === 'CHAR_LIT' ||
      tok.kind === 'STRING_LIT' ||
      tok.kind === 'DATE_LIT' ||
      tok.kind === 'IDENT' ||
      (tok.kind === 'KEYWORD' && (tok.text === 'TRUE' || tok.text === 'FALSE'));
    if (!isLabelStart) return false;

    if (this.peek(1).kind === 'COLON') return true;
    const to = this.peek(1);
    if (to.kind === 'KEYWORD' && to.text === 'TO' && this.peek(3).kind === 'COLON') return true;
    return false;
  }

  private parseCase(): Stmt {
    const start = this.advance().span; // CASE
    this.expect('KEYWORD', 'OF');
    const selector = this.parseExpr();
    this.endOfLine();

    this.openBlocks.push({ keyword: 'CASE OF', expected: 'ENDCASE', span: start });

    const clauses: CaseClause[] = [];
    let otherwise: Stmt[] | undefined;
    let sawOtherwise = false;

    this.skipNewlines();
    while (!this.check('EOF') && !this.checkKeyword('ENDCASE')) {
      if (this.checkKeyword('OTHERWISE')) {
        const otherTok = this.advance();
        if (sawOtherwise) {
          this.sink.report('E2041', otherTok.span, {
            message: 'there is already an OTHERWISE clause',
            label: 'a second OTHERWISE',
          });
          this.syntaxErrors += 1;
        }
        sawOtherwise = true;
        this.expect('COLON', ':');
        otherwise = this.parseCaseBody();
        continue;
      }

      if (sawOtherwise) {
        this.sink.report('E2041', this.current.span, {
          message: 'OTHERWISE must be the last case',
          label: 'comes after OTHERWISE',
          help: 'Move the OTHERWISE clause to the end, just before ENDCASE.',
        });
        this.syntaxErrors += 1;
      }

      const from = this.parseLiteralOnly('a case label', true);
      let to: Expr | undefined;
      if (this.matchKeyword('TO') !== null) to = this.parseLiteralOnly('a case label', true);
      this.expect('COLON', ':');
      const body = this.parseCaseBody();
      const clause: CaseClause = { from, body, span: mergeSpans(from.span, from.span) };
      clauses.push(to === undefined ? clause : { ...clause, to });
    }

    this.openBlocks.pop();
    const end = this.expect('KEYWORD', 'ENDCASE');
    this.endOfLine();

    const stmt: Stmt = { kind: 'Case', selector, clauses, span: mergeSpans(start, end.span) };
    return otherwise === undefined ? stmt : { ...stmt, otherwise };
  }

  /** Statements belonging to one CASE clause, up to the next label. */
  private parseCaseBody(): Stmt[] {
    const body: Stmt[] = [];
    for (;;) {
      this.skipNewlines();
      if (this.check('EOF') || this.checkKeyword('ENDCASE', 'OTHERWISE')) break;
      if (this.looksLikeCaseLabel()) break;
      const before = this.pos;
      try {
        body.push(this.parseStatement());
      } catch (err) {
        if (!(err instanceof StatementError)) throw err;
        this.synchronise();
      }
      if (this.pos === before) this.advance();
    }
    return body;
  }

  private tokenLineText(tok: Token): string {
    // Reconstructs the statement text for the E2001 hint without needing the
    // source file: the tokens on this line are enough.
    const parts: string[] = [];
    for (const t of this.tokens) {
      if (t.span.line !== tok.span.line) continue;
      if (t.kind === 'NEWLINE' || t.kind === 'EOF') continue;
      parts.push(t.text);
    }
    return parts.join(' ');
  }

  private exprText(expr: Expr): string {
    switch (expr.kind) {
      case 'Ident':
        return expr.name;
      case 'Member':
        return `${this.exprText(expr.target)}.${expr.field}`;
      case 'Index':
        return `${this.exprText(expr.target)}[...]`;
      case 'Deref':
        return `${this.exprText(expr.target)}^`;
      default:
        return 'expression';
    }
  }

  // ------------------------------------------------------------------ types

  parseTypeRef(): TypeRef {
    const tok = this.current;

    if (tok.kind === 'KEYWORD' && tok.text === 'ARRAY') {
      this.advance();
      this.expect('LBRACKET', '[');
      const dims: ArrayDim[] = [];
      for (;;) {
        const lower = this.parseExpr();
        this.expect('COLON', ':');
        const upper = this.parseExpr();
        dims.push({ lower, upper });
        if (!this.match('COMMA')) break;
      }
      this.expect('RBRACKET', ']');
      if (dims.length > 2) {
        this.fail('E2084', tok.span, {
          message: `an array may have one or two dimensions, not ${dims.length}`,
          label: 'too many dimensions',
          help: 'The 9618 syllabus covers one-dimensional and two-dimensional\narrays only.',
        });
      }
      this.expect('KEYWORD', 'OF');
      const element = this.parseTypeRef();
      return { kind: 'ArrayType', dims, element, span: mergeSpans(tok.span, element.span) };
    }

    if (tok.kind === 'KEYWORD' && PRIMITIVE_NAMES.has(tok.text)) {
      this.advance();
      return { kind: 'PrimitiveType', name: tok.text as PrimitiveName, span: tok.span };
    }

    if (tok.kind === 'IDENT') {
      this.advance();
      return { kind: 'NamedType', name: tok.text, span: tok.span };
    }

    this.fail('E2084', tok.span, {
      message: `expected a type, found ${describeToken(tok)}`,
      label: 'expected a type',
      help: 'The built-in types are INTEGER, REAL, CHAR, STRING, BOOLEAN and DATE.',
    });
  }

  // ------------------------------------------------------------ expressions

  parseExpr(): Expr {
    return this.parseBinary(1);
  }

  private peekBinaryOp(): BinOp | null {
    const tok = this.current;
    switch (tok.kind) {
      case 'PLUS':
        return 'ADD';
      case 'MINUS':
        return 'SUB';
      case 'STAR':
        return 'MUL';
      case 'SLASH':
        return 'DIV_REAL';
      case 'AMP':
        return 'CONCAT';
      case 'EQ':
        return 'EQ';
      case 'NEQ':
        return 'NEQ';
      case 'LT':
        return 'LT';
      case 'LTE':
        return 'LTE';
      case 'GT':
        return 'GT';
      case 'GTE':
        return 'GTE';
      case 'KEYWORD':
        if (tok.text === 'DIV') return 'DIV_INT';
        if (tok.text === 'MOD') return 'MOD';
        if (tok.text === 'AND') return 'AND';
        if (tok.text === 'OR') return 'OR';
        return null;
      default:
        return null;
    }
  }

  private parseBinary(minPrec: number): Expr {
    // NOT binds looser than the relational operators.
    if (minPrec <= 3 && this.checkKeyword('NOT')) {
      const notTok = this.advance();
      const operand = this.parseBinary(3);
      return { kind: 'Unary', op: 'NOT', operand, span: mergeSpans(notTok.span, operand.span) };
    }

    let left = this.parseUnary();
    let sawRelational = false;

    for (;;) {
      const op = this.peekBinaryOp();
      if (op === null) break;
      const prec = BINARY_PRECEDENCE[op];
      if (prec < minPrec) break;

      if (RELATIONAL.has(op)) {
        if (sawRelational) {
          this.fail('E2060', this.current.span, {
            label: 'a second comparison',
            help: 'Write the two comparisons separately and join them with AND,\nfor example (a < b) AND (b < c).',
          });
        }
        sawRelational = true;
      }

      this.advance();
      const right = this.parseBinary(prec + 1);
      left = { kind: 'Binary', op, left, right, span: mergeSpans(left.span, right.span) };
    }

    return left;
  }

  private parseUnary(): Expr {
    if (this.check('MINUS')) {
      const tok = this.advance();
      const operand = this.parseUnary();
      return { kind: 'Unary', op: 'NEG', operand, span: mergeSpans(tok.span, operand.span) };
    }
    if (this.check('CARET')) {
      const tok = this.advance();
      const operand = this.parseUnary();
      if (!isLValue(operand)) {
        this.fail('E2050', mergeSpans(tok.span, operand.span), {
          label: 'not a variable',
          help: '`^` takes the address of a variable, an array element or a\nrecord field.',
        });
      }
      return { kind: 'Unary', op: 'ADDR', operand, span: mergeSpans(tok.span, operand.span) };
    }
    if (this.checkKeyword('NOT')) {
      const tok = this.advance();
      const operand = this.parseBinary(3);
      return { kind: 'Unary', op: 'NOT', operand, span: mergeSpans(tok.span, operand.span) };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();

    for (;;) {
      if (this.check('LBRACKET')) {
        this.advance();
        const indices = [this.parseExpr()];
        while (this.match('COMMA')) indices.push(this.parseExpr());
        const close = this.expect('RBRACKET', ']');
        expr = { kind: 'Index', target: expr, indices, span: mergeSpans(expr.span, close.span) };
        continue;
      }

      if (this.check('DOT')) {
        this.advance();
        const field = this.expectMemberName();
        if (this.check('LPAREN')) {
          const args = this.parseArgList();
          expr = {
            kind: 'MethodCall',
            target: expr,
            method: field.text,
            args: args.args,
            span: mergeSpans(expr.span, args.span),
          };
        } else {
          expr = {
            kind: 'Member',
            target: expr,
            field: field.text,
            span: mergeSpans(expr.span, field.span),
          };
        }
        continue;
      }

      if (this.check('CARET')) {
        const tok = this.advance();
        expr = { kind: 'Deref', target: expr, span: mergeSpans(expr.span, tok.span) };
        continue;
      }

      return expr;
    }
  }

  private parseArgList(): { args: Expr[]; span: Span } {
    const open = this.expect('LPAREN', '(');
    const args: Expr[] = [];
    if (!this.check('RPAREN')) {
      args.push(this.parseExpr());
      while (this.match('COMMA')) args.push(this.parseExpr());
    }
    const close = this.expect('RPAREN', ')');
    return { args, span: mergeSpans(open.span, close.span) };
  }

  private parsePrimary(): Expr {
    const tok = this.current;

    switch (tok.kind) {
      case 'INT_LIT':
        this.advance();
        return { kind: 'IntLit', value: tok.value as number, span: tok.span };
      case 'REAL_LIT':
        this.advance();
        return { kind: 'RealLit', value: tok.value as number, span: tok.span };
      case 'STRING_LIT':
        this.advance();
        return { kind: 'StringLit', value: tok.value as string, span: tok.span };
      case 'CHAR_LIT':
        this.advance();
        return { kind: 'CharLit', value: tok.value as string, span: tok.span };
      case 'DATE_LIT': {
        this.advance();
        const d = tok.value as { day: number; month: number; year: number };
        return { kind: 'DateLit', day: d.day, month: d.month, year: d.year, span: tok.span };
      }
      case 'LPAREN': {
        this.advance();
        const inner = this.parseExpr();
        this.expect('RPAREN', ')');
        return inner;
      }
      case 'IDENT': {
        this.advance();
        if (this.check('LPAREN')) {
          const args = this.parseArgList();
          return {
            kind: 'Call',
            callee: tok.text,
            args: args.args,
            span: mergeSpans(tok.span, args.span),
          };
        }
        return { kind: 'Ident', name: tok.text, span: tok.span };
      }
      case 'KEYWORD':
        return this.parseKeywordPrimary(tok);
      default:
        this.fail('E2012', tok.span, {
          message: `expected a value, found ${describeToken(tok)}`,
          label: 'expected a value',
        });
    }
  }

  private parseKeywordPrimary(tok: Token): Expr {
    if (tok.text === 'TRUE' || tok.text === 'FALSE') {
      this.advance();
      return { kind: 'BoolLit', value: tok.text === 'TRUE', span: tok.span };
    }

    if (tok.text === 'NEW') {
      this.advance();
      const className = this.expectIdent();
      const args = this.check('LPAREN') ? this.parseArgList() : { args: [], span: className.span };
      return {
        kind: 'New',
        className: className.text,
        args: args.args,
        span: mergeSpans(tok.span, args.span),
      };
    }

    // SUPER is only ever the target of a member access, which parsePostfix
    // handles; representing it as an identifier keeps that path uniform.
    if (tok.text === 'SUPER') {
      this.advance();
      return { kind: 'Ident', name: 'SUPER', span: tok.span };
    }

    // The eight library functions are keywords but are called like functions.
    if (this.peek(1).kind === 'LPAREN') {
      this.advance();
      const args = this.parseArgList();
      return {
        kind: 'Call',
        callee: tok.text,
        args: args.args,
        span: mergeSpans(tok.span, args.span),
      };
    }

    this.fail('E2012', tok.span, {
      message: `expected a value, found ${describeToken(tok)}`,
      label: 'expected a value',
    });
  }

  private parseLValue(): LValue {
    const expr = this.parsePostfix();
    if (!isLValue(expr)) {
      this.fail('E2070', expr.span, {
        label: 'not a variable',
        help: 'Expected a variable, an array element, a record field or a\ndereferenced pointer.',
      });
    }
    return expr;
  }

  private parseLiteralOnly(what: string, allowNamed = false): Expr {
    const negate = this.check('MINUS');
    if (negate) this.advance();
    const tok = this.current;
    const literalKinds: TokenKind[] = ['INT_LIT', 'REAL_LIT', 'STRING_LIT', 'CHAR_LIT', 'DATE_LIT'];
    const isBool = tok.kind === 'KEYWORD' && (tok.text === 'TRUE' || tok.text === 'FALSE');
    const isNamed = allowNamed && tok.kind === 'IDENT';
    if (!literalKinds.includes(tok.kind) && !isBool && !isNamed) {
      this.fail('E2040', tok.span, {
        message: `${what} must be a literal, found ${describeToken(tok)}`,
        label: 'expected a literal',
        help: 'Only a literal can be used here. A variable, another constant or an\nexpression must never be used.',
      });
    }
    const literal = this.parsePrimary();
    if (!negate) return literal;
    if (literal.kind === 'Ident') {
      this.fail('E2040', literal.span, { label: 'cannot be negated' });
    }
    if (literal.kind !== 'IntLit' && literal.kind !== 'RealLit') {
      this.fail('E2040', literal.span, { label: 'cannot be negated' });
    }
    return { ...literal, value: -literal.value };
  }
}

export function parse(
  tokens: Token[],
  sink: DiagnosticSink = new DiagnosticSink(),
): { program: Program; sink: DiagnosticSink } {
  const program = new Parser(tokens, sink).parseProgram();
  return { program, sink };
}

export { PseudoError };

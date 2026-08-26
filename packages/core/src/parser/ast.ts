import type { Span } from '../diagnostics/error';

// ---------------------------------------------------------------- type refs

export type TypeRef =
  | { kind: 'PrimitiveType'; name: PrimitiveName; span: Span }
  | { kind: 'ArrayType'; dims: ArrayDim[]; element: TypeRef; span: Span }
  | { kind: 'NamedType'; name: string; span: Span };

export type PrimitiveName = 'INTEGER' | 'REAL' | 'CHAR' | 'STRING' | 'BOOLEAN' | 'DATE';

export interface ArrayDim {
  lower: Expr;
  upper: Expr;
}

// -------------------------------------------------------------- expressions

export type BinOp =
  | 'ADD'
  | 'SUB'
  | 'MUL'
  | 'DIV_REAL'
  | 'DIV_INT'
  | 'MOD'
  | 'CONCAT'
  | 'EQ'
  | 'NEQ'
  | 'LT'
  | 'LTE'
  | 'GT'
  | 'GTE'
  | 'AND'
  | 'OR';

export type UnOp = 'NEG' | 'NOT' | 'ADDR';

export type Expr =
  | { kind: 'IntLit'; value: number; span: Span }
  | { kind: 'RealLit'; value: number; span: Span }
  | { kind: 'StringLit'; value: string; span: Span }
  | { kind: 'CharLit'; value: string; span: Span }
  | { kind: 'BoolLit'; value: boolean; span: Span }
  | { kind: 'DateLit'; day: number; month: number; year: number; span: Span }
  | { kind: 'Ident'; name: string; span: Span }
  | { kind: 'Binary'; op: BinOp; left: Expr; right: Expr; span: Span }
  | { kind: 'Unary'; op: UnOp; operand: Expr; span: Span }
  | { kind: 'Index'; target: Expr; indices: Expr[]; span: Span }
  | { kind: 'Member'; target: Expr; field: string; span: Span }
  | { kind: 'Deref'; target: Expr; span: Span }
  | { kind: 'Call'; callee: string; args: Expr[]; span: Span }
  | { kind: 'MethodCall'; target: Expr; method: string; args: Expr[]; span: Span }
  | { kind: 'New'; className: string; args: Expr[]; span: Span };

/** The expression forms that name a storage location. */
export type LValue =
  | Extract<Expr, { kind: 'Ident' }>
  | Extract<Expr, { kind: 'Index' }>
  | Extract<Expr, { kind: 'Member' }>
  | Extract<Expr, { kind: 'Deref' }>;

export function isLValue(expr: Expr): expr is LValue {
  return (
    expr.kind === 'Ident' ||
    expr.kind === 'Index' ||
    expr.kind === 'Member' ||
    expr.kind === 'Deref'
  );
}

// --------------------------------------------------------------- statements

export type FileOp =
  | 'OPENFILE'
  | 'READFILE'
  | 'WRITEFILE'
  | 'CLOSEFILE'
  | 'SEEK'
  | 'GETRECORD'
  | 'PUTRECORD';

export type FileMode = 'READ' | 'WRITE' | 'APPEND' | 'RANDOM';

export interface Param {
  name: string;
  typeRef: TypeRef;
  byRef: boolean;
  span: Span;
}

export interface SubprogramDecl {
  name: string;
  params: Param[];
  /** Present exactly when the subprogram is a FUNCTION. */
  returns?: TypeRef;
  body: Stmt[];
  access?: 'PUBLIC' | 'PRIVATE';
  span: Span;
}

export type TypeDeclaration =
  | { kind: 'Record'; name: string; fields: RecordField[]; span: Span }
  | { kind: 'Enum'; name: string; values: string[]; span: Span }
  | { kind: 'Pointer'; name: string; target: TypeRef; span: Span }
  | { kind: 'Set'; name: string; base: TypeRef; span: Span };

export interface RecordField {
  name: string;
  typeRef: TypeRef;
  span: Span;
}

export interface ClassField {
  name: string;
  typeRef: TypeRef;
  access: 'PUBLIC' | 'PRIVATE';
  span: Span;
}

export interface ClassDeclaration {
  name: string;
  inherits?: string;
  fields: ClassField[];
  methods: SubprogramDecl[];
  span: Span;
}

export interface CaseClause {
  from: Expr;
  to?: Expr;
  body: Stmt[];
  span: Span;
}

export type Stmt =
  | { kind: 'Declare'; name: string; typeRef: TypeRef; span: Span }
  | { kind: 'Constant'; name: string; value: Expr; span: Span }
  | { kind: 'Assign'; target: LValue; value: Expr; span: Span }
  | { kind: 'Input'; target: LValue; span: Span }
  | { kind: 'Output'; values: Expr[]; span: Span }
  | { kind: 'If'; cond: Expr; then: Stmt[]; otherwise?: Stmt[]; span: Span }
  | { kind: 'Case'; selector: Expr; clauses: CaseClause[]; otherwise?: Stmt[]; span: Span }
  | { kind: 'For'; varName: string; from: Expr; to: Expr; step?: Expr; body: Stmt[]; span: Span }
  | { kind: 'Repeat'; body: Stmt[]; until: Expr; span: Span }
  | { kind: 'While'; cond: Expr; body: Stmt[]; span: Span }
  | { kind: 'ProcDecl'; decl: SubprogramDecl; span: Span }
  | { kind: 'FuncDecl'; decl: SubprogramDecl; span: Span }
  | { kind: 'CallStmt'; callee: string; args: Expr[]; span: Span }
  | { kind: 'MethodCallStmt'; target: Expr; method: string; args: Expr[]; span: Span }
  | { kind: 'Return'; value?: Expr; span: Span }
  | { kind: 'TypeDecl'; decl: TypeDeclaration; span: Span }
  | { kind: 'Define'; name: string; values: Expr[]; setType: string; span: Span }
  | { kind: 'ClassDecl'; decl: ClassDeclaration; span: Span }
  | {
      kind: 'FileStmt';
      op: FileOp;
      file: Expr;
      mode?: FileMode;
      target?: LValue;
      value?: Expr;
      span: Span;
    };

export interface Program {
  body: Stmt[];
}

/**
 * Every line on which a statement begins. The debug adapter uses this to snap
 * breakpoints onto executable lines.
 */
export function statementLines(body: Stmt[], into = new Set<number>()): Set<number> {
  for (const stmt of body) {
    into.add(stmt.span.line);
    for (const nested of childBlocks(stmt)) statementLines(nested, into);
  }
  return into;
}

export function childBlocks(stmt: Stmt): Stmt[][] {
  switch (stmt.kind) {
    case 'If':
      return stmt.otherwise === undefined ? [stmt.then] : [stmt.then, stmt.otherwise];
    case 'Case': {
      const blocks = stmt.clauses.map((c) => c.body);
      if (stmt.otherwise !== undefined) blocks.push(stmt.otherwise);
      return blocks;
    }
    case 'For':
    case 'While':
      return [stmt.body];
    case 'Repeat':
      return [stmt.body];
    case 'ProcDecl':
    case 'FuncDecl':
      return [stmt.decl.body];
    case 'ClassDecl':
      return stmt.decl.methods.map((m) => m.body);
    default:
      return [];
  }
}

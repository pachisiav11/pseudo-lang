import type { DiagCode } from '../diagnostics/codes';
import { type DiagnosticInit, PseudoError, type Span } from '../diagnostics/error';
import { type Frame, type Host, type RunOptions } from '../host';
import { isValidDate } from '../lexer/lexer';
import type { Expr, LValue, Program, Stmt, TypeRef } from '../parser/ast';
import { Cell } from './cell';
import { applyBinary, applyUnary } from './operators';
import { Scope } from './scope';
import { type PType, typeName } from './types';
import {
  type PValue,
  assignable,
  bool,
  char,
  coerceForStore,
  formatValue,
  int,
  isComposite,
  real,
  str,
  typeOfValue,
  valueTypeName,
} from './value';

export class Interpreter {
  readonly globals = new Scope(null, 'global');
  private readonly frames: Frame[] = [];

  constructor(
    readonly host: Host,
    readonly options: RunOptions,
  ) {}

  get callStack(): readonly Frame[] {
    return this.frames;
  }

  // ------------------------------------------------------------------ entry

  async run(program: Program): Promise<void> {
    await this.execBlock(program.body, this.globals);
  }

  async execBlock(body: Stmt[], scope: Scope): Promise<void> {
    for (const stmt of body) {
      await this.execStmt(stmt, scope);
    }
  }

  async execStmt(stmt: Stmt, scope: Scope): Promise<void> {
    // Every statement passes through the host so the debugger can park here.
    await this.host.beforeStatement(stmt, this.frames);

    switch (stmt.kind) {
      case 'Declare':
        return this.execDeclare(stmt, scope);
      case 'Constant':
        return this.execConstant(stmt, scope);
      case 'Assign':
        return this.execAssign(stmt, scope);
      case 'Output':
        return this.execOutput(stmt, scope);
      case 'Input':
        return this.execInput(stmt, scope);
      case 'If':
        return this.execIf(stmt, scope);
      case 'While':
        return this.execWhile(stmt, scope);
      case 'Repeat':
        return this.execRepeat(stmt, scope);
      case 'For':
        return this.execFor(stmt, scope);
      case 'Case':
        return this.execCase(stmt, scope);
      default:
        throw this.error('E2002', stmt.span, {
          message: `\`${stmt.kind}\` is not supported yet`,
        });
    }
  }

  // ------------------------------------------------------------- statements

  private async execDeclare(
    stmt: Extract<Stmt, { kind: 'Declare' }>,
    scope: Scope,
  ): Promise<void> {
    if (scope.own(stmt.name) !== undefined) {
      throw this.error('E3003', stmt.span, {
        message: `\`${stmt.name}\` is already declared`,
        label: 'declared twice',
      });
    }
    scope.define(stmt.name, await this.resolveType(stmt.typeRef, scope));
  }

  private async execConstant(
    stmt: Extract<Stmt, { kind: 'Constant' }>,
    scope: Scope,
  ): Promise<void> {
    if (scope.own(stmt.name) !== undefined) {
      throw this.error('E3003', stmt.span, {
        message: `\`${stmt.name}\` is already declared`,
        label: 'declared twice',
      });
    }
    const value = await this.evaluate(stmt.value, scope);
    const cell = scope.define(stmt.name, typeOfValue(value), true);
    cell.value = value;
  }

  private async execAssign(stmt: Extract<Stmt, { kind: 'Assign' }>, scope: Scope): Promise<void> {
    const value = await this.evaluate(stmt.value, scope);
    const cell = await this.resolveLValue(stmt.target, scope, value);
    this.store(cell, value, stmt.span);
  }

  store(cell: Cell, value: PValue, span: Span): void {
    if (cell.isConstant) {
      throw this.error('E3004', span, {
        message: `\`${cell.name}\` is a constant and cannot be changed`,
        label: 'constant',
      });
    }
    if (!assignable(cell.declared, value)) {
      throw this.error('E3012', span, {
        message: `cannot store ${valueTypeName(value)} in \`${cell.name}\`, which is ${typeName(cell.declared)}`,
        label: `this is ${valueTypeName(value)}`,
        help: this.assignmentHelp(cell.declared, value),
      });
    }
    cell.value = deepCopy(coerceForStore(cell.declared, value));
  }

  private assignmentHelp(declared: PType, value: PValue): string | undefined {
    if (declared.k === 'INTEGER' && value.t === 'REAL') {
      return 'A REAL is never truncated automatically. Use INT(x) to take the\nwhole part.';
    }
    if (declared.k === 'STRING' && value.t === 'CHAR') {
      return 'A CHAR uses single quotes and a STRING uses double quotes. Join it\nwith "" using & to make a STRING.';
    }
    if (declared.k === 'CHAR' && value.t === 'STRING') {
      return 'A CHAR holds exactly one character and uses single quotes.';
    }
    return undefined;
  }

  private async execOutput(stmt: Extract<Stmt, { kind: 'Output' }>, scope: Scope): Promise<void> {
    let line = '';
    for (const expr of stmt.values) {
      const value = await this.evaluate(expr, scope);
      if (isComposite(value) && value.t !== 'SET') {
        throw this.error('E3050', expr.span, {
          message: `OUTPUT cannot print a ${valueTypeName(value)}`,
          label: 'not a single value',
          help: 'Output the individual elements or fields instead.',
        });
      }
      line += formatValue(value);
    }
    await this.host.write(`${line}\n`);
  }

  private async execInput(stmt: Extract<Stmt, { kind: 'Input' }>, scope: Scope): Promise<void> {
    const line = await this.host.readLine();
    if (line === null) {
      throw this.error('E3052', stmt.span, {
        message: 'INPUT was reached but there is no more input',
        label: 'no input left',
      });
    }
    const placeholder = str(line);
    const cell = await this.resolveLValue(stmt.target, scope, placeholder);
    const value = this.convertInput(line, cell.declared, stmt.span, cell.name);
    this.store(cell, value, stmt.span);
  }

  private convertInput(line: string, declared: PType, span: Span, name: string): PValue {
    const text = line.trim();
    const bad = (want: string): PseudoError =>
      this.error('E3051', span, {
        message: `\`${line}\` is not ${want}, which is what \`${name}\` holds`,
        label: 'could not convert the input',
      });

    switch (declared.k) {
      case 'INTEGER':
        if (!/^[+-]?\d+$/.test(text)) throw bad('a whole number');
        return int(Number(text));
      case 'REAL':
        if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) throw bad('a number');
        return real(Number(text));
      case 'CHAR':
        if ([...text].length !== 1) throw bad('a single character');
        return char(text);
      case 'BOOLEAN': {
        const upper = text.toUpperCase();
        if (upper !== 'TRUE' && upper !== 'FALSE') throw bad('TRUE or FALSE');
        return bool(upper === 'TRUE');
      }
      case 'DATE': {
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
        if (m === null) throw bad('a date in the form dd/mm/yyyy');
        const value = { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) };
        if (!isValidDate(value)) throw bad('a valid calendar date');
        return { t: 'DATE', ...value };
      }
      case 'STRING':
        return str(line);
      default:
        throw this.error('E3051', span, {
          message: `INPUT cannot read a value of type ${typeName(declared)}`,
          label: 'not an input type',
        });
    }
  }

  // ----------------------------------------------------------- control flow

  private async condition(expr: Expr, scope: Scope, what: string): Promise<boolean> {
    const value = await this.evaluate(expr, scope);
    if (value.t !== 'BOOLEAN') {
      throw this.error('E3098', expr.span, {
        message: `the ${what} must be TRUE or FALSE, but this is ${valueTypeName(value)}`,
        label: `this is ${valueTypeName(value)}`,
      });
    }
    return value.v;
  }

  private async execIf(stmt: Extract<Stmt, { kind: 'If' }>, scope: Scope): Promise<void> {
    if (await this.condition(stmt.cond, scope, 'condition of an IF')) {
      await this.execBlock(stmt.then, scope);
    } else if (stmt.otherwise !== undefined) {
      await this.execBlock(stmt.otherwise, scope);
    }
  }

  private async execWhile(stmt: Extract<Stmt, { kind: 'While' }>, scope: Scope): Promise<void> {
    while (await this.condition(stmt.cond, scope, 'condition of a WHILE')) {
      await this.execBlock(stmt.body, scope);
    }
  }

  private async execRepeat(stmt: Extract<Stmt, { kind: 'Repeat' }>, scope: Scope): Promise<void> {
    for (;;) {
      await this.execBlock(stmt.body, scope);
      if (await this.condition(stmt.until, scope, 'condition of an UNTIL')) return;
    }
  }

  private async wholeNumber(expr: Expr, scope: Scope, what: string): Promise<number> {
    const value = await this.evaluate(expr, scope);
    if (value.t !== 'INTEGER') {
      throw this.error('E3030', expr.span, {
        message: `${what} must be a whole number, but this is ${valueTypeName(value)}`,
        label: `this is ${valueTypeName(value)}`,
      });
    }
    return value.v;
  }

  private async execFor(stmt: Extract<Stmt, { kind: 'For' }>, scope: Scope): Promise<void> {
    // The guide fixes no evaluation order, so all three are taken once, in
    // written order, before the loop starts.
    const from = await this.wholeNumber(stmt.from, scope, 'the start value of a FOR loop');
    const to = await this.wholeNumber(stmt.to, scope, 'the end value of a FOR loop');
    const step =
      stmt.step === undefined ? 1 : await this.wholeNumber(stmt.step, scope, 'a STEP value');

    if (step === 0) {
      throw this.error('E3031', stmt.step?.span ?? stmt.span, {
        message: 'STEP cannot be zero, because the loop would never end',
        label: 'zero step',
      });
    }

    let cell = scope.lookup(stmt.varName);
    if (cell === undefined) {
      if (this.options.strictDeclarations) {
        throw this.error('E3002', stmt.span, {
          message: `\`${stmt.varName}\` is not declared`,
          label: 'not declared',
          help: `Declare it first:\nDECLARE ${stmt.varName} : INTEGER`,
        });
      }
      cell = scope.define(stmt.varName, { k: 'INTEGER' });
    } else if (cell.declared.k !== 'INTEGER') {
      throw this.error('E3030', stmt.span, {
        message: `\`${cell.name}\` is ${typeName(cell.declared)}, but a FOR loop counts with an INTEGER`,
        label: 'not an INTEGER',
      });
    }

    let i = from;
    for (;;) {
      // Storing before the test leaves the counter holding the first value
      // that failed it, which is what a reader expects after the loop.
      cell.value = int(i);
      if (step > 0 ? i > to : i < to) return;
      await this.execBlock(stmt.body, scope);
      // Reading the counter back lets the body change it, which the guide
      // does not forbid.
      const current = cell.value;
      i = (current !== undefined && current.t === 'INTEGER' ? current.v : i) + step;
    }
  }

  private async execCase(stmt: Extract<Stmt, { kind: 'Case' }>, scope: Scope): Promise<void> {
    const selector = await this.evaluate(stmt.selector, scope);

    for (const clause of stmt.clauses) {
      const from = await this.evaluate(clause.from, scope);
      this.checkCaseLabel(selector, from, clause.from.span);

      if (clause.to === undefined) {
        const equal = applyBinary('EQ', selector, from, clause.from.span);
        if (equal.t === 'BOOLEAN' && equal.v) {
          await this.execBlock(clause.body, scope);
          return;
        }
        continue;
      }

      const to = await this.evaluate(clause.to, scope);
      this.checkCaseLabel(selector, to, clause.to.span);
      const atLeast = applyBinary('GTE', selector, from, clause.from.span);
      const atMost = applyBinary('LTE', selector, to, clause.to.span);
      if (atLeast.t === 'BOOLEAN' && atLeast.v && atMost.t === 'BOOLEAN' && atMost.v) {
        await this.execBlock(clause.body, scope);
        return;
      }
    }

    if (stmt.otherwise !== undefined) await this.execBlock(stmt.otherwise, scope);
  }

  private checkCaseLabel(selector: PValue, label: PValue, span: Span): void {
    const numeric = (v: PValue): boolean => v.t === 'INTEGER' || v.t === 'REAL';
    if (numeric(selector) && numeric(label)) return;
    if (selector.t === label.t) return;
    const charString =
      (selector.t === 'STRING' && label.t === 'CHAR') ||
      (selector.t === 'CHAR' && label.t === 'STRING');
    throw this.error('E3040', span, {
      message: `this case is ${valueTypeName(label)} but the CASE selector is ${valueTypeName(selector)}`,
      label: `this is ${valueTypeName(label)}`,
      help: charString
        ? "CHAR and STRING are different types. A variable that is read with\nINPUT and never declared holds a STRING, so declare it as a CHAR\nfirst if you want to match single-quoted cases."
        : undefined,
    });
  }

  // ------------------------------------------------------------------ types

  async resolveType(ref: TypeRef, scope: Scope): Promise<PType> {
    switch (ref.kind) {
      case 'PrimitiveType':
        return { k: ref.name } as PType;
      case 'ArrayType':
        throw this.error('E3061', ref.span, { message: 'arrays are not supported yet' });
      case 'NamedType':
        throw this.error('E3061', ref.span, {
          message: `unknown type \`${ref.name}\``,
          label: 'not a known type',
        });
    }
  }

  // ------------------------------------------------------------ expressions

  async evaluate(expr: Expr, scope: Scope): Promise<PValue> {
    switch (expr.kind) {
      case 'IntLit':
        return int(expr.value);
      case 'RealLit':
        return real(expr.value);
      case 'StringLit':
        return str(expr.value);
      case 'CharLit':
        return char(expr.value);
      case 'BoolLit':
        return bool(expr.value);
      case 'DateLit':
        return { t: 'DATE', day: expr.day, month: expr.month, year: expr.year };

      case 'Ident': {
        const cell = scope.lookup(expr.name);
        if (cell === undefined) {
          throw this.error('E3001', expr.span, {
            message: `\`${expr.name}\` is used before it is given a value`,
            label: 'never assigned',
            help: 'Assign to it first, or declare it with DECLARE.',
          });
        }
        if (cell.value === undefined) {
          throw this.error('E3001', expr.span, {
            message: `\`${cell.name}\` is used before it is given a value`,
            label: 'declared but never assigned',
          });
        }
        return cell.value;
      }

      case 'Unary': {
        if (expr.op === 'ADDR') {
          throw this.error('E3061', expr.span, { message: 'pointers are not supported yet' });
        }
        const operand = await this.evaluate(expr.operand, scope);
        return applyUnary(expr.op, operand, expr.span);
      }

      case 'Binary': {
        const left = await this.evaluate(expr.left, scope);
        // AND and OR do not short-circuit in the guide, but evaluating the
        // right side only when it can change the answer never observably
        // differs, since pseudocode expressions have no side effects.
        const right = await this.evaluate(expr.right, scope);
        return applyBinary(expr.op, left, right, expr.span);
      }

      default:
        throw this.error('E3090', expr.span, {
          message: `\`${expr.kind}\` is not supported yet`,
        });
    }
  }

  // ---------------------------------------------------------------- lvalues

  /**
   * Resolves an assignment target to its Cell. `hint` types a variable that is
   * being created implicitly.
   */
  async resolveLValue(target: LValue, scope: Scope, hint?: PValue): Promise<Cell> {
    switch (target.kind) {
      case 'Ident': {
        const existing = scope.lookup(target.name);
        if (existing !== undefined) return existing;
        if (this.options.strictDeclarations || hint === undefined) {
          throw this.error('E3002', target.span, {
            message: `\`${target.name}\` is not declared`,
            label: 'not declared',
            help: 'Declare it first, for example:\nDECLARE ' + target.name + ' : INTEGER',
          });
        }
        return scope.define(target.name, typeOfValue(hint));
      }
      default:
        throw this.error('E3061', target.span, {
          message: `\`${target.kind}\` targets are not supported yet`,
        });
    }
  }

  // ----------------------------------------------------------------- errors

  error(code: DiagCode, span: Span, init: DiagnosticInit = {}): PseudoError {
    const err = new PseudoError(code, span, init);
    err.callStack = this.frames
      .slice()
      .reverse()
      .map((f) => `${f.name} (line ${f.line})`);
    return err;
  }
}

/**
 * Arrays and records assign by value (guide sections 3.2 and 4.2); everything
 * else is immutable or, for objects and pointers, deliberately by reference.
 */
export function deepCopy(value: PValue): PValue {
  switch (value.t) {
    case 'ARRAY':
      return {
        t: 'ARRAY',
        arr: {
          dims: value.arr.dims.map((d) => ({ ...d })),
          element: value.arr.element,
          cells: value.arr.cells.map(
            (c) => new Cell(c.declared, c.value === undefined ? undefined : deepCopy(c.value), c.name),
          ),
        },
      };
    case 'RECORD': {
      const fields = new Map<string, Cell>();
      for (const [key, cell] of value.fields) {
        fields.set(
          key,
          new Cell(cell.declared, cell.value === undefined ? undefined : deepCopy(cell.value), cell.name),
        );
      }
      return { t: 'RECORD', typeName: value.typeName, fields };
    }
    case 'SET':
      return { t: 'SET', typeName: value.typeName, members: value.members.map(deepCopy) };
    default:
      return value;
  }
}

import { DiagnosticSink, type SourceFile, type Span } from '../diagnostics/error';
import { isKeyword } from './keywords';
import {
  CONTINUATION_KEYWORDS,
  CONTINUATION_KINDS,
  type DateValue,
  type Token,
  type TokenKind,
} from './token';

const ARROW = '←';

/** Days per month, index 1..12. February is corrected for leap years. */
const MONTH_LENGTHS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function isValidDate(d: DateValue): boolean {
  if (d.month < 1 || d.month > 12) return false;
  if (d.year < 1) return false;
  const max = d.month === 2 && isLeapYear(d.year) ? 29 : (MONTH_LENGTHS[d.month] ?? 0);
  return d.day >= 1 && d.day <= max;
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isAsciiLetter(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

function isIdentPart(c: string): boolean {
  return isAsciiLetter(c) || isDigit(c) || c === '_';
}

/** A letter that is not a plain A-Z / a-z, e.g. an accented one. */
function isExoticLetter(c: string): boolean {
  return c !== '' && !isAsciiLetter(c) && /\p{L}/u.test(c);
}

class Lexer {
  private readonly text: string;
  private i = 0;
  private line = 1;
  private lineStart = 0;
  private readonly tokens: Token[] = [];

  constructor(
    private readonly source: SourceFile,
    private readonly sink: DiagnosticSink,
  ) {
    this.text = source.text;
  }

  private at(offset = 0): string {
    return this.text.charAt(this.i + offset);
  }

  private get col(): number {
    return this.i - this.lineStart + 1;
  }

  private spanFrom(startLine: number, startCol: number): Span {
    return { line: startLine, col: startCol, endLine: this.line, endCol: this.col };
  }

  private push(kind: TokenKind, text: string, span: Span, value?: Token['value']): void {
    const tok: Token = value === undefined ? { kind, text, span } : { kind, text, span, value };
    this.tokens.push(tok);
  }

  private get last(): Token | undefined {
    return this.tokens[this.tokens.length - 1];
  }

  /** True when a line break here continues the previous line's statement. */
  private isContinuation(): boolean {
    const last = this.last;
    if (last === undefined) return true;
    if (CONTINUATION_KINDS.has(last.kind)) return true;
    if (last.kind === 'KEYWORD' && CONTINUATION_KEYWORDS.has(last.text)) return true;
    return false;
  }

  private newLine(): void {
    // Handles \r\n, \n and \r alike.
    if (this.at() === '\r' && this.at(1) === '\n') this.i += 2;
    else this.i += 1;
    this.line += 1;
    this.lineStart = this.i;
  }

  run(): Token[] {
    for (;;) {
      const c = this.at();
      if (c === '') break;

      if (c === ' ' || c === '\t') {
        this.i += 1;
        continue;
      }

      if (c === '/' && this.at(1) === '/') {
        while (this.at() !== '' && this.at() !== '\n' && this.at() !== '\r') this.i += 1;
        continue;
      }

      if (c === '\n' || c === '\r') {
        const breakLine = this.line;
        const breakCol = this.col;
        const suppress = this.isContinuation() || this.last?.kind === 'NEWLINE';
        this.newLine();
        if (!suppress) {
          this.push('NEWLINE', '\\n', {
            line: breakLine,
            col: breakCol,
            endLine: breakLine,
            endCol: breakCol + 1,
          });
        }
        continue;
      }

      this.scanToken();
    }

    if (this.last !== undefined && this.last.kind !== 'NEWLINE') {
      this.push('NEWLINE', '\\n', this.spanFrom(this.line, this.col));
    }
    this.push('EOF', '', this.spanFrom(this.line, this.col));
    return this.tokens;
  }

  private scanToken(): void {
    const startLine = this.line;
    const startCol = this.col;
    const c = this.at();

    if (isDigit(c)) return this.scanNumberOrDate(startLine, startCol);
    if (isAsciiLetter(c)) return this.scanWord(startLine, startCol);
    if (c === '"') return this.scanString(startLine, startCol);
    if (c === "'") return this.scanChar(startLine, startCol);

    if (isExoticLetter(c)) {
      const start = this.i;
      while (isExoticLetter(this.at()) || isIdentPart(this.at())) this.i += 1;
      const whole = this.text.slice(start, this.i);
      const span = this.spanFrom(startLine, startCol);
      this.sink.report('E1015', span, {
        message: `\`${whole}\` contains an accented letter`,
        label: 'accented letter',
        help: 'Identifiers may only contain A-Z, a-z, 0-9 and the underscore.',
      });
      this.push('IDENT', whole, span);
      return;
    }

    // Two-character operators must be tried before their one-character prefixes.
    if (c === '<') {
      if (this.at(1) === '-') return this.simple('ASSIGN', 2, startLine, startCol);
      if (this.at(1) === '=') return this.simple('LTE', 2, startLine, startCol);
      if (this.at(1) === '>') return this.simple('NEQ', 2, startLine, startCol);
      return this.simple('LT', 1, startLine, startCol);
    }
    if (c === '>') {
      if (this.at(1) === '=') return this.simple('GTE', 2, startLine, startCol);
      return this.simple('GT', 1, startLine, startCol);
    }
    if (c === ARROW) return this.simple('ASSIGN', 1, startLine, startCol);

    if (c === '.' && isDigit(this.at(1))) {
      const dotStart = this.i;
      this.i += 1;
      while (isDigit(this.at())) this.i += 1;
      const span = this.spanFrom(startLine, startCol);
      this.sink.report('E1011', span, {
        label: 'no digit before the decimal point',
        help: 'Real literals are always written with at least one digit on each\nside of the decimal point, for example 0.3 rather than .3',
      });
      const text = this.text.slice(dotStart, this.i);
      this.push('REAL_LIT', text, span, Number(`0${text}`));
      return;
    }

    const singles: Record<string, TokenKind> = {
      '+': 'PLUS',
      '-': 'MINUS',
      '*': 'STAR',
      '/': 'SLASH',
      '&': 'AMP',
      '^': 'CARET',
      '=': 'EQ',
      '(': 'LPAREN',
      ')': 'RPAREN',
      '[': 'LBRACKET',
      ']': 'RBRACKET',
      ',': 'COMMA',
      ':': 'COLON',
      '.': 'DOT',
    };
    const kind = singles[c];
    if (kind !== undefined) return this.simple(kind, 1, startLine, startCol);

    this.i += 1;
    this.sink.report('E1001', this.spanFrom(startLine, startCol), {
      message: `unexpected character \`${c}\``,
    });
  }

  private simple(kind: TokenKind, width: number, startLine: number, startCol: number): void {
    const text = this.text.slice(this.i, this.i + width);
    this.i += width;
    this.push(kind, text, this.spanFrom(startLine, startCol));
  }

  private scanNumberOrDate(startLine: number, startCol: number): void {
    const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(this.text.slice(this.i, this.i + 10));
    if (dateMatch !== null) {
      const after = this.text.charAt(this.i + 10);
      if (!isDigit(after) && after !== '/') {
        const value: DateValue = {
          day: Number(dateMatch[1]),
          month: Number(dateMatch[2]),
          year: Number(dateMatch[3]),
        };
        const text = this.text.slice(this.i, this.i + 10);
        this.i += 10;
        const span = this.spanFrom(startLine, startCol);
        if (!isValidDate(value)) {
          this.sink.report('E1010', span, {
            message: `\`${text}\` is not a valid calendar date`,
            label: 'invalid date',
            help: 'Dates are written dd/mm/yyyy.',
          });
        }
        this.push('DATE_LIT', text, span, value);
        return;
      }
    }

    const numberStart = this.i;
    while (isDigit(this.at())) this.i += 1;

    let isReal = false;
    if (this.at() === '.') {
      if (isDigit(this.at(1))) {
        isReal = true;
        this.i += 1;
        while (isDigit(this.at())) this.i += 1;
      } else if (this.at(1) !== '.') {
        // "4." — the guide requires a digit on both sides of the point.
        this.i += 1;
        const span = this.spanFrom(startLine, startCol);
        this.sink.report('E1011', span, {
          label: 'no digit after the decimal point',
          help: 'Real literals are always written with at least one digit on each\nside of the decimal point, for example 4.0 rather than 4.',
        });
        this.push('REAL_LIT', this.text.slice(numberStart, this.i), span, Number(this.text.slice(numberStart, this.i - 1)));
        return;
      }
    }

    const text = this.text.slice(numberStart, this.i);
    const span = this.spanFrom(startLine, startCol);

    if (isAsciiLetter(this.at()) || this.at() === '_') {
      while (isIdentPart(this.at())) this.i += 1;
      const whole = this.text.slice(numberStart, this.i);
      this.sink.report('E1014', this.spanFrom(startLine, startCol), {
        message: `\`${whole}\` is not a valid identifier`,
        label: 'starts with a digit',
        help: 'Identifiers must start with a letter.',
      });
      this.push('IDENT', whole, this.spanFrom(startLine, startCol));
      return;
    }

    this.push(isReal ? 'REAL_LIT' : 'INT_LIT', text, span, Number(text));
  }

  private scanWord(startLine: number, startCol: number): void {
    const start = this.i;
    while (isIdentPart(this.at())) this.i += 1;

    if (isExoticLetter(this.at())) {
      while (isExoticLetter(this.at()) || isIdentPart(this.at())) this.i += 1;
      const whole = this.text.slice(start, this.i);
      const span = this.spanFrom(startLine, startCol);
      this.sink.report('E1015', span, {
        message: `\`${whole}\` contains an accented letter`,
        label: 'accented letter',
        help: 'Identifiers may only contain A-Z, a-z, 0-9 and the underscore.',
      });
      this.push('IDENT', whole, span);
      return;
    }

    const text = this.text.slice(start, this.i);
    const span = this.spanFrom(startLine, startCol);
    this.push(isKeyword(text) ? 'KEYWORD' : 'IDENT', text, span);
  }

  private scanString(startLine: number, startCol: number): void {
    this.i += 1; // opening quote
    const start = this.i;
    while (this.at() !== '"' && this.at() !== '' && this.at() !== '\n' && this.at() !== '\r') {
      this.i += 1;
    }
    const value = this.text.slice(start, this.i);

    if (this.at() !== '"') {
      const span = this.spanFrom(startLine, startCol);
      this.sink.report('E1012', span, {
        label: 'string is not closed before the end of the line',
        help: 'Strings are delimited by double quotes and cannot span lines.',
      });
      this.push('STRING_LIT', `"${value}`, span, value);
      return;
    }

    this.i += 1; // closing quote
    this.push('STRING_LIT', `"${value}"`, this.spanFrom(startLine, startCol), value);
  }

  private scanChar(startLine: number, startCol: number): void {
    this.i += 1; // opening quote
    const start = this.i;
    while (this.at() !== "'" && this.at() !== '' && this.at() !== '\n' && this.at() !== '\r') {
      this.i += 1;
    }
    const value = this.text.slice(start, this.i);
    const closed = this.at() === "'";
    if (closed) this.i += 1;

    const span = this.spanFrom(startLine, startCol);
    if (!closed || [...value].length !== 1) {
      this.sink.report('E1013', span, {
        message:
          value.length === 0
            ? 'a character literal cannot be empty'
            : `\`'${value}'\` contains ${[...value].length} characters`,
        label: 'expected exactly one character',
        help: 'Use single quotes for one CHAR, and double quotes for a STRING.',
      });
    }
    this.push('CHAR_LIT', `'${value}'`, span, value);
  }
}

export function lex(source: SourceFile, sink: DiagnosticSink = new DiagnosticSink()): {
  tokens: Token[];
  sink: DiagnosticSink;
} {
  const tokens = new Lexer(source, sink).run();
  return { tokens, sink };
}

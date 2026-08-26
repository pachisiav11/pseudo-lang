import { describe, expect, it } from 'vitest';
import { errorOf, exec, outputOf } from '../testing';

describe('M2 acceptance', () => {
  it('runs the milestone example', async () => {
    const program = [
      'CONSTANT Rate = 6.50',
      'DECLARE Hours : INTEGER',
      'Hours <- 2',
      'OUTPUT "Penalty is ", Hours * Rate',
    ].join('\n');
    expect(await outputOf(program)).toBe('Penalty is 13.0\n');
  });
});

describe('literals and output', () => {
  it('prints a REAL with at least one decimal digit', async () => {
    expect(await outputOf('OUTPUT 4.0')).toBe('4.0\n');
    expect(await outputOf('OUTPUT 6 / 2')).toBe('3.0\n');
    expect(await outputOf('OUTPUT 0.3')).toBe('0.3\n');
  });

  it('prints booleans as TRUE and FALSE', async () => {
    expect(await outputOf('OUTPUT TRUE, " ", FALSE')).toBe('TRUE FALSE\n');
  });

  it('prints a date as dd/mm/yyyy', async () => {
    expect(await outputOf('DECLARE D : DATE\nD <- 02/01/2005\nOUTPUT D')).toBe('02/01/2005\n');
  });

  it('joins values with no separator of its own', async () => {
    const program = ['DECLARE Lives : INTEGER', 'Lives <- 3', 'OUTPUT "You have ", Lives, " lives left"'].join('\n');
    expect(await outputOf(program)).toBe('You have 3 lives left\n');
  });
});

describe('arithmetic', () => {
  it('always makes / produce a REAL', async () => {
    expect(await outputOf('OUTPUT 7 / 2')).toBe('3.5\n');
  });

  it('truncates DIV toward zero and keeps the sign of the dividend for MOD', async () => {
    expect(await outputOf('OUTPUT 7 DIV 2')).toBe('3\n');
    expect(await outputOf('OUTPUT -7 DIV 2')).toBe('-3\n');
    expect(await outputOf('OUTPUT 7 MOD 2')).toBe('1\n');
    expect(await outputOf('OUTPUT -7 MOD 2')).toBe('-1\n');
  });

  it('widens INTEGER to REAL in mixed expressions', async () => {
    expect(await outputOf('OUTPUT 1 + 2.5')).toBe('3.5\n');
  });

  it('rejects DIV on a REAL', async () => {
    expect(await errorOf('OUTPUT 7.0 DIV 2')).toBe('E3010');
  });

  it('rejects division by zero', async () => {
    expect(await errorOf('OUTPUT 1 / 0')).toBe('E3011');
    expect(await errorOf('OUTPUT 1 MOD 0')).toBe('E3011');
  });

  it('applies the documented precedence', async () => {
    expect(await outputOf('OUTPUT 2 + 3 * 4')).toBe('14\n');
    expect(await outputOf('OUTPUT (2 + 3) * 4')).toBe('20\n');
  });
});

describe('strings', () => {
  it('concatenates with &', async () => {
    expect(await outputOf('OUTPUT "Summer" & " " & "Pudding"')).toBe('Summer Pudding\n');
  });

  it('lets a CHAR join a STRING', async () => {
    expect(await outputOf("OUTPUT \"Grade \" & 'A'")).toBe('Grade A\n');
  });

  it('refuses to compare a CHAR with a STRING', async () => {
    expect(await errorOf("OUTPUT 'A' = \"A\"")).toBe('E3013');
  });
});

describe('logic', () => {
  it('evaluates AND, OR and NOT', async () => {
    expect(await outputOf('OUTPUT TRUE AND FALSE')).toBe('FALSE\n');
    expect(await outputOf('OUTPUT TRUE OR FALSE')).toBe('TRUE\n');
    expect(await outputOf('OUTPUT NOT TRUE')).toBe('FALSE\n');
  });

  it('binds NOT looser than a comparison', async () => {
    expect(await outputOf('OUTPUT NOT 1 = 2')).toBe('TRUE\n');
  });

  it('rejects a chained comparison', async () => {
    expect(await errorOf('OUTPUT 1 < 2 < 3')).toBe('E2060');
  });
});

describe('declarations and assignment', () => {
  it('allows implicit declaration by default', async () => {
    expect(await outputOf('Counter <- 0\nCounter <- Counter + 1\nOUTPUT Counter')).toBe('1\n');
  });

  it('requires DECLARE in strict mode', async () => {
    const result = await exec('Counter <- 0', [], { strictDeclarations: true });
    expect(result.code).toBe('E3002');
  });

  it('treats identifiers as case-insensitive', async () => {
    expect(await outputOf('Countdown <- 5\nOUTPUT CountDown')).toBe('5\n');
  });

  it('reports a variable used before it is given a value', async () => {
    expect(await errorOf('DECLARE X : INTEGER\nOUTPUT X')).toBe('E3001');
    expect(await errorOf('OUTPUT Nothing')).toBe('E3001');
  });

  it('reports a duplicate declaration', async () => {
    expect(await errorOf('DECLARE X : INTEGER\nDECLARE X : REAL')).toBe('E3003');
  });

  it('refuses to change a constant', async () => {
    expect(await errorOf('CONSTANT Rate = 6.50\nRate <- 7.0')).toBe('E3004');
  });

  it('refuses a non-literal constant', async () => {
    expect(await errorOf('DECLARE X : INTEGER\nX <- 1\nCONSTANT Y = X')).toBe('E2040');
  });

  it('widens INTEGER into a REAL variable', async () => {
    expect(await outputOf('DECLARE X : REAL\nX <- 5\nOUTPUT X')).toBe('5.0\n');
  });

  it('never truncates a REAL into an INTEGER variable', async () => {
    expect(await errorOf('DECLARE X : INTEGER\nX <- 2.5')).toBe('E3012');
  });

  it('keeps CHAR and STRING apart', async () => {
    expect(await errorOf("DECLARE C : CHAR\nC <- \"ab\"")).toBe('E3012');
    expect(await errorOf("DECLARE S : STRING\nS <- 'a'")).toBe('E3012');
  });
});

describe('input', () => {
  it('converts to the declared type', async () => {
    const program = ['DECLARE Age : INTEGER', 'INPUT Age', 'OUTPUT Age + 1'].join('\n');
    expect(await outputOf(program, ['41'])).toBe('42\n');
  });

  it('reads a STRING when the variable is new', async () => {
    expect(await outputOf('INPUT Name\nOUTPUT "Hello ", Name', ['Ali'])).toBe('Hello Ali\n');
  });

  it('reports input that cannot be converted', async () => {
    const result = await exec('DECLARE Age : INTEGER\nINPUT Age', ['abc']);
    expect(result.code).toBe('E3051');
  });

  it('reports the end of input', async () => {
    const result = await exec('DECLARE Age : INTEGER\nINPUT Age', []);
    expect(result.code).toBe('E3052');
  });
});

describe('assignment syntax', () => {
  it('names the arrow when = is used to assign', async () => {
    const result = await exec('Total = 0');
    expect(result.code).toBe('E2001');
    expect(result.errors[0]?.help).toContain('<-');
  });

  it('accepts the arrow character', async () => {
    expect(await outputOf('Total ← 7\nOUTPUT Total')).toBe('7\n');
  });

  it('reports a lower-case keyword', async () => {
    const result = await exec('output 5');
    expect(result.code).toBe('E2010');
  });
});

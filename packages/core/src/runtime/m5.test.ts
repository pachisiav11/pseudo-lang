import { describe, expect, it } from 'vitest';
import { errorOf, exec, outputOf } from '../testing';

describe('M5 acceptance: the guide examples', () => {
  it('runs the SWAP procedure', async () => {
    // The guide notes that BYVAL/BYREF "need not be repeated", so Y is also
    // passed by reference here and the swap is complete.
    const program = `
PROCEDURE SWAP(BYREF X : INTEGER, Y : INTEGER)
   Temp <- X
   X <- Y
   Y <- Temp
ENDPROCEDURE

DECLARE A : INTEGER
DECLARE B : INTEGER
A <- 1
B <- 2
CALL SWAP(A, B)
OUTPUT A, " ", B
`;
    expect(await outputOf(program)).toBe('2 1\n');
  });

  it('runs the Max function example', async () => {
    const program = `
FUNCTION Max(Number1 : INTEGER, Number2 : INTEGER) RETURNS INTEGER
   IF Number1 > Number2 THEN
      RETURN Number1
   ELSE
      RETURN Number2
   ENDIF
ENDFUNCTION

Distance <- 7
OUTPUT "Penalty Fine = ", Max(10, Distance*2)
`;
    expect(await outputOf(program)).toBe('Penalty Fine = 14\n');
  });

  it('calls a procedure defined further down the file', async () => {
    const program = `
PROCEDURE DefaultSquare()
   CALL Square(100)
ENDPROCEDURE

PROCEDURE Square(Size : INTEGER)
   FOR Side <- 1 TO 4
      OUTPUT "side ", Size
   NEXT Side
ENDPROCEDURE

CALL DefaultSquare()
`;
    expect(await outputOf(program)).toBe('side 100\nside 100\nside 100\nside 100\n');
  });
});

describe('parameter passing', () => {
  it('passes by value unless told otherwise', async () => {
    const program = `
PROCEDURE Change(N : INTEGER)
   N <- 99
ENDPROCEDURE
DECLARE A : INTEGER
A <- 1
CALL Change(A)
OUTPUT A
`;
    expect(await outputOf(program)).toBe('1\n');
  });

  it('writes through a BYREF parameter', async () => {
    const program = `
PROCEDURE Change(BYREF N : INTEGER)
   N <- 99
ENDPROCEDURE
DECLARE A : INTEGER
A <- 1
CALL Change(A)
OUTPUT A
`;
    expect(await outputOf(program)).toBe('99\n');
  });

  it('switches back to BYVAL when told', async () => {
    const program = `
PROCEDURE P(BYREF A : INTEGER, BYVAL B : INTEGER)
   A <- 10
   B <- 20
ENDPROCEDURE
DECLARE X : INTEGER
DECLARE Y : INTEGER
X <- 1
Y <- 2
CALL P(X, Y)
OUTPUT X, " ", Y
`;
    expect(await outputOf(program)).toBe('10 2\n');
  });

  it('passes an array element BYREF', async () => {
    const program = `
PROCEDURE Change(BYREF N : INTEGER)
   N <- 42
ENDPROCEDURE
DECLARE A : ARRAY[1:3] OF INTEGER
A[2] <- 0
CALL Change(A[2])
OUTPUT A[2]
`;
    expect(await outputOf(program)).toBe('42\n');
  });

  it('refuses an expression for a BYREF parameter', async () => {
    const program = `
PROCEDURE Change(BYREF N : INTEGER)
   N <- 1
ENDPROCEDURE
CALL Change(1 + 2)
`;
    expect(await errorOf(program)).toBe('E3094');
  });

  it('refuses BYREF on a function parameter', async () => {
    const program = `
FUNCTION F(BYREF N : INTEGER) RETURNS INTEGER
   RETURN N
ENDFUNCTION
`;
    expect(await errorOf(program)).toBe('E2081');
  });

  it('reports the wrong number of arguments', async () => {
    const program = `
PROCEDURE P(A : INTEGER, B : INTEGER)
   OUTPUT A
ENDPROCEDURE
CALL P(1)
`;
    const result = await exec(program);
    expect(result.code).toBe('E3093');
    expect(result.errors[0]?.message).toContain('2 arguments');
  });

  it('type-checks arguments', async () => {
    const program = `
PROCEDURE P(A : INTEGER)
   OUTPUT A
ENDPROCEDURE
CALL P("text")
`;
    expect(await errorOf(program)).toBe('E3096');
  });
});

describe('procedures and functions are not interchangeable', () => {
  it('rejects CALL on a function', async () => {
    const program = `
FUNCTION F() RETURNS INTEGER
   RETURN 1
ENDFUNCTION
CALL F()
`;
    expect(await errorOf(program)).toBe('E2082');
  });

  it('rejects a procedure used as a value', async () => {
    const program = `
PROCEDURE P()
   OUTPUT "hi"
ENDPROCEDURE
OUTPUT P()
`;
    expect(await errorOf(program)).toBe('E3105');
  });

  it('rejects RETURN inside a procedure', async () => {
    const program = `
PROCEDURE P()
   RETURN 1
ENDPROCEDURE
CALL P()
`;
    expect(await errorOf(program)).toBe('E2080');
  });

  it('rejects a function that never returns', async () => {
    const program = `
FUNCTION F() RETURNS INTEGER
   OUTPUT "nothing"
ENDFUNCTION
OUTPUT F()
`;
    expect(await errorOf(program)).toBe('E3095');
  });

  it('rejects a nested subprogram', async () => {
    const program = `
PROCEDURE Outer()
   PROCEDURE Inner()
   ENDPROCEDURE
ENDPROCEDURE
`;
    expect(await errorOf(program)).toBe('E2020');
  });

  it('reports an unknown procedure', async () => {
    expect(await errorOf('CALL Missing()')).toBe('E3092');
  });
});

describe('scope and recursion', () => {
  it('keeps locals separate from globals of the same name', async () => {
    const program = `
PROCEDURE P()
   DECLARE N : INTEGER
   N <- 5
ENDPROCEDURE
DECLARE N : INTEGER
N <- 1
CALL P()
OUTPUT N
`;
    expect(await outputOf(program)).toBe('1\n');
  });

  it('lets a subprogram update a global', async () => {
    const program = `
DECLARE Total : INTEGER
Total <- 0
PROCEDURE Add(N : INTEGER)
   Total <- Total + N
ENDPROCEDURE
CALL Add(3)
CALL Add(4)
OUTPUT Total
`;
    expect(await outputOf(program)).toBe('7\n');
  });

  it('supports recursion', async () => {
    const program = `
FUNCTION Factorial(N : INTEGER) RETURNS INTEGER
   IF N <= 1 THEN
      RETURN 1
   ELSE
      RETURN N * Factorial(N - 1)
   ENDIF
ENDFUNCTION
OUTPUT Factorial(6)
`;
    expect(await outputOf(program)).toBe('720\n');
  });

  it('turns runaway recursion into a diagnostic', async () => {
    const program = `
FUNCTION F(N : INTEGER) RETURNS INTEGER
   RETURN F(N + 1)
ENDFUNCTION
OUTPUT F(1)
`;
    const result = await exec(program, [], { maxCallDepth: 50 });
    expect(result.code).toBe('E3020');
    expect(result.errors[0]?.callStack.length).toBeGreaterThan(0);
  });
});

describe('the eight library functions', () => {
  it('matches the guide examples', async () => {
    expect(await outputOf('OUTPUT RIGHT("ABCDEFGH", 3)')).toBe('FGH\n');
    expect(await outputOf('OUTPUT LENGTH("Happy Days")')).toBe('10\n');
    expect(await outputOf('OUTPUT MID("ABCDEFGH", 2, 3)')).toBe('BCD\n');
    expect(await outputOf("OUTPUT LCASE('W')")).toBe('w\n');
    expect(await outputOf("OUTPUT UCASE('h')")).toBe('H\n');
    expect(await outputOf('OUTPUT INT(27.5415)')).toBe('27\n');
  });

  it('leaves a character alone when it cannot change case', async () => {
    expect(await outputOf("OUTPUT LCASE('7')")).toBe('7\n');
    expect(await outputOf("OUTPUT UCASE('7')")).toBe('7\n');
  });

  it('truncates INT toward zero', async () => {
    expect(await outputOf('OUTPUT INT(-27.9)')).toBe('-27\n');
    expect(await outputOf('OUTPUT INT(5)')).toBe('5\n');
  });

  it('keeps RAND inside the range', async () => {
    const program = `
DECLARE R : REAL
R <- RAND(87)
IF R >= 0.0 AND R < 87.0 THEN
   OUTPUT "in range"
ENDIF
`;
    expect(await outputOf(program)).toBe('in range\n');
  });

  it('reports a RAND argument that is not positive', async () => {
    expect(await errorOf('OUTPUT RAND(0)')).toBe('E3097');
  });

  it('reports string positions that are out of range', async () => {
    expect(await errorOf('OUTPUT MID("ABC", 0, 1)')).toBe('E3091');
    expect(await errorOf('OUTPUT MID("ABC", 2, 5)')).toBe('E3091');
    expect(await errorOf('OUTPUT RIGHT("ABC", 9)')).toBe('E3091');
  });

  it('reports the wrong argument type', async () => {
    const result = await exec('OUTPUT LCASE("W")');
    expect(result.code).toBe('E3096');
    expect(result.errors[0]?.help).toContain("LCASE('W')");
  });

  it('reports the wrong number of arguments', async () => {
    expect(await errorOf('OUTPUT LENGTH("a", "b")')).toBe('E3093');
  });

  it('refuses a function the guide does not define', async () => {
    const result = await exec('OUTPUT LEFT("ABC", 1)');
    expect(result.code).toBe('E3090');
    expect(result.errors[0]?.help).toContain('RIGHT, LENGTH, MID');
  });
});

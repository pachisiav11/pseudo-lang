import { describe, expect, it } from 'vitest';
import { errorOf, exec, outputOf } from '../testing';

describe('M4 acceptance: the guide examples', () => {
  it('declares the guide arrays', async () => {
    const program = `
DECLARE StudentNames : ARRAY[1:30] OF STRING
DECLARE NoughtsAndCrosses : ARRAY[1:3,1:3] OF CHAR
StudentNames[1] <- "Ali"
NoughtsAndCrosses[2,3] <- 'X'
OUTPUT StudentNames[1], NoughtsAndCrosses[2,3]
`;
    expect(await outputOf(program)).toBe('AliX\n');
  });

  it('runs the array initialisation loop', async () => {
    const program = `
DECLARE StudentNames : ARRAY[1:30] OF STRING
FOR Index <- 1 TO 30
   StudentNames[Index] <- ""
NEXT Index
OUTPUT "[", StudentNames[30], "]"
`;
    expect(await outputOf(program)).toBe('[]\n');
  });

  it('shifts elements with StudentNames[n+1] <- StudentNames[n]', async () => {
    const program = `
DECLARE StudentNames : ARRAY[1:5] OF STRING
n <- 2
StudentNames[n] <- "Ali"
StudentNames[n+1] <- StudentNames[n]
OUTPUT StudentNames[3]
`;
    expect(await outputOf(program)).toBe('Ali\n');
  });

  it('runs the nested-FOR grand total over a 2-D array', async () => {
    const program = `
DECLARE Amount : ARRAY[1:2,1:10] OF INTEGER
FOR Row <- 1 TO 2
   FOR Column <- 1 TO 10
      Amount[Row, Column] <- Row * Column
   NEXT Column
NEXT Row

Total <- 0
MaxRow <- 2
FOR Row <- 1 TO MaxRow
   RowTotal <- 0
   FOR Column <- 1 TO 10
      RowTotal <- RowTotal + Amount[Row, Column]
   NEXT Column
   OUTPUT "Total for Row ", Row, " is ", RowTotal
   Total <- Total + RowTotal
NEXT Row
OUTPUT "The grand total is ", Total
`;
    expect(await outputOf(program)).toBe(
      'Total for Row 1 is 55\nTotal for Row 2 is 110\nThe grand total is 165\n',
    );
  });

  it('copies a whole array', async () => {
    const program = `
DECLARE NoughtsAndCrosses : ARRAY[1:3,1:3] OF CHAR
DECLARE SavedGame : ARRAY[1:3,1:3] OF CHAR
NoughtsAndCrosses[1,1] <- 'X'
SavedGame <- NoughtsAndCrosses
NoughtsAndCrosses[1,1] <- 'O'
OUTPUT SavedGame[1,1], NoughtsAndCrosses[1,1]
`;
    expect(await outputOf(program)).toBe('XO\n');
  });
});

describe('array bounds', () => {
  it('respects a lower bound that is not 1', async () => {
    const program = `
DECLARE A : ARRAY[0:2] OF INTEGER
A[0] <- 10
A[2] <- 30
OUTPUT A[0], " ", A[2]
`;
    expect(await outputOf(program)).toBe('10 30\n');
  });

  it('reports an index above the upper bound with the declared range', async () => {
    const result = await exec('DECLARE A : ARRAY[1:30] OF STRING\nA[31] <- ""');
    expect(result.code).toBe('E3082');
    expect(result.errors[0]?.message).toContain('31');
    expect(result.errors[0]?.help).toContain('1 to 30');
  });

  it('reports an index below the lower bound', async () => {
    expect(await errorOf('DECLARE A : ARRAY[1:5] OF INTEGER\nA[0] <- 1')).toBe('E3082');
  });

  it('reports an out-of-range index on a read', async () => {
    expect(await errorOf('DECLARE A : ARRAY[1:5] OF INTEGER\nA[1] <- 1\nOUTPUT A[9]')).toBe('E3082');
  });

  it('rejects the wrong number of indices', async () => {
    expect(await errorOf('DECLARE A : ARRAY[1:3,1:3] OF INTEGER\nA[1] <- 1')).toBe('E3083');
    expect(await errorOf('DECLARE A : ARRAY[1:3] OF INTEGER\nA[1,1] <- 1')).toBe('E3083');
  });

  it('rejects indexing something that is not an array', async () => {
    expect(await errorOf('X <- 5\nOUTPUT X[1]')).toBe('E3084');
  });

  it('rejects a non-integer index', async () => {
    expect(await errorOf('DECLARE A : ARRAY[1:5] OF INTEGER\nOUTPUT A[1.5]')).toBe('E3030');
  });

  it('rejects an empty range', async () => {
    expect(await errorOf('DECLARE A : ARRAY[5:1] OF INTEGER')).toBe('E3082');
  });
});

describe('array types', () => {
  it('type-checks elements', async () => {
    expect(await errorOf('DECLARE A : ARRAY[1:3] OF INTEGER\nA[1] <- "text"')).toBe('E3012');
  });

  it('reads an element that was never assigned', async () => {
    expect(await errorOf('DECLARE A : ARRAY[1:3] OF INTEGER\nOUTPUT A[1]')).toBe('E3001');
  });

  it('refuses to output a whole array', async () => {
    expect(await errorOf('DECLARE A : ARRAY[1:3] OF INTEGER\nOUTPUT A')).toBe('E3050');
  });

  it('refuses to copy arrays of a different shape', async () => {
    const program = `
DECLARE A : ARRAY[1:3] OF INTEGER
DECLARE B : ARRAY[1:4] OF INTEGER
B <- A
`;
    expect(await errorOf(program)).toBe('E3080');
  });

  it('accepts bounds given as expressions', async () => {
    const program = `
Size <- 4
DECLARE A : ARRAY[1:Size] OF INTEGER
A[4] <- 9
OUTPUT A[4]
`;
    expect(await outputOf(program)).toBe('9\n');
  });

  it('rejects three dimensions', async () => {
    expect(await errorOf('DECLARE A : ARRAY[1:2,1:2,1:2] OF INTEGER')).toBe('E2085');
  });
});

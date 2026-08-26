import { describe, expect, it } from 'vitest';
import { errorOf, exec, outputOf } from '../testing';

const STUDENT_RECORD = `
TYPE StudentRecord
   DECLARE LastName : STRING
   DECLARE FirstName : STRING
   DECLARE DateOfBirth : DATE
   DECLARE YearGroup : INTEGER
   DECLARE FormGroup : CHAR
ENDTYPE
`;

describe('M6 acceptance: the guide examples', () => {
  it('runs the StudentRecord example', async () => {
    const program = `${STUDENT_RECORD}
DECLARE Pupil1 : StudentRecord
DECLARE Pupil2 : StudentRecord
DECLARE Form : ARRAY[1:30] OF StudentRecord

Pupil1.LastName <- "Johnson"
Pupil1.FirstName <- "Leroy"
Pupil1.DateOfBirth <- 02/01/2005
Pupil1.YearGroup <- 6
Pupil1.FormGroup <- 'A'

Pupil2 <- Pupil1

FOR Index <- 1 TO 30
   Form[Index].YearGroup <- 6
NEXT Index
FOR Index <- 1 TO 30
   Form[Index].YearGroup <- Form[Index].YearGroup + 1
NEXT Index

OUTPUT Pupil2.FirstName, " ", Pupil2.LastName
OUTPUT Pupil2.DateOfBirth, " ", Pupil2.YearGroup, " ", Pupil2.FormGroup
OUTPUT Form[30].YearGroup
`;
    expect(await outputOf(program)).toBe('Leroy Johnson\n02/01/2005 6 A\n7\n');
  });

  it('declares and uses an enumerated type', async () => {
    const program = `
TYPE Season = (Spring, Summer, Autumn, Winter)
DECLARE ThisSeason : Season
DECLARE NextSeason : Season
ThisSeason <- Spring
NextSeason <- Summer
OUTPUT ThisSeason, " then ", NextSeason
`;
    expect(await outputOf(program)).toBe('Spring then Summer\n');
  });

  it('declares and uses a pointer type', async () => {
    const program = `
TYPE TIntPointer = ^INTEGER
DECLARE MyPointer : TIntPointer
DECLARE Counter : INTEGER
Counter <- 5
MyPointer <- ^Counter
OUTPUT MyPointer^
MyPointer^ <- 9
OUTPUT Counter
`;
    expect(await outputOf(program)).toBe('5\n9\n');
  });

  it('declares a set type and defines a set', async () => {
    const program = `
TYPE LetterSet = SET OF CHAR
DEFINE Vowels ('A','E','I','O','U') : LetterSet
DECLARE MySet : LetterSet
MySet <- Vowels
IF MySet = Vowels THEN
   OUTPUT "same"
ENDIF
`;
    expect(await outputOf(program)).toBe('same\n');
  });
});

describe('records', () => {
  it('copies a record by value', async () => {
    const program = `${STUDENT_RECORD}
DECLARE A : StudentRecord
DECLARE B : StudentRecord
A.LastName <- "One"
B <- A
A.LastName <- "Two"
OUTPUT B.LastName, " ", A.LastName
`;
    expect(await outputOf(program)).toBe('One Two\n');
  });

  it('type-checks a field', async () => {
    const program = `${STUDENT_RECORD}
DECLARE A : StudentRecord
A.YearGroup <- "six"
`;
    expect(await errorOf(program)).toBe('E3012');
  });

  it('reports an unknown field and lists the real ones', async () => {
    const program = `${STUDENT_RECORD}
DECLARE A : StudentRecord
A.Height <- 1
`;
    const result = await exec(program);
    expect(result.code).toBe('E3073');
    expect(result.errors[0]?.help).toContain('LastName');
  });

  it('reports a field access on something that is not a record', async () => {
    expect(await errorOf('X <- 5\nOUTPUT X.Field')).toBe('E3072');
  });

  it('reports a field that was never assigned', async () => {
    const program = `${STUDENT_RECORD}
DECLARE A : StudentRecord
OUTPUT A.LastName
`;
    expect(await errorOf(program)).toBe('E3001');
  });

  it('nests a record inside a record', async () => {
    const program = `
TYPE Point
   DECLARE X : INTEGER
   DECLARE Y : INTEGER
ENDTYPE
TYPE Line
   DECLARE From : Point
   DECLARE To : Point
ENDTYPE
DECLARE L : Line
L.From.X <- 1
L.To.X <- 9
OUTPUT L.From.X, " ", L.To.X
`;
    expect(await outputOf(program)).toBe('1 9\n');
  });

  it('refuses to output a whole record', async () => {
    const program = `${STUDENT_RECORD}
DECLARE A : StudentRecord
OUTPUT A
`;
    expect(await errorOf(program)).toBe('E3050');
  });

  it('reports an unknown type', async () => {
    const result = await exec('DECLARE A : Nonsense');
    expect(result.code).toBe('E3061');
    expect(result.errors[0]?.help).toContain('TYPE');
  });
});

describe('enumerated types', () => {
  it('compares by declaration order', async () => {
    const program = `
TYPE Season = (Spring, Summer, Autumn, Winter)
DECLARE A : Season
DECLARE B : Season
A <- Spring
B <- Winter
IF A < B THEN
   OUTPUT "Spring comes first"
ENDIF
`;
    expect(await outputOf(program)).toBe('Spring comes first\n');
  });

  it('keeps two enumerated types apart', async () => {
    const program = `
TYPE Season = (Spring, Summer)
TYPE Colour = (Red, Green)
DECLARE A : Season
A <- Red
`;
    expect(await errorOf(program)).toBe('E3012');
  });

  it('switches on an enumerated value', async () => {
    const program = `
TYPE Season = (Spring, Summer, Autumn, Winter)
DECLARE S : Season
S <- Autumn
CASE OF S
   Spring : OUTPUT "warming"
   Autumn : OUTPUT "cooling"
   OTHERWISE : OUTPUT "extreme"
ENDCASE
`;
    expect(await outputOf(program)).toBe('cooling\n');
  });
});

describe('pointers', () => {
  it('points at an array element and writes through it', async () => {
    const program = `
TYPE TIntPointer = ^INTEGER
DECLARE P : TIntPointer
DECLARE A : ARRAY[1:3] OF INTEGER
A[2] <- 1
P <- ^A[2]
P^ <- 7
OUTPUT A[2]
`;
    expect(await outputOf(program)).toBe('7\n');
  });

  it('points at a record field', async () => {
    const program = `
TYPE Point
   DECLARE X : INTEGER
ENDTYPE
TYPE TIntPointer = ^INTEGER
DECLARE P : TIntPointer
DECLARE Q : Point
Q.X <- 3
P <- ^Q.X
OUTPUT P^
`;
    expect(await outputOf(program)).toBe('3\n');
  });

  it('reports a dereference before an address is given', async () => {
    const program = `
TYPE TIntPointer = ^INTEGER
DECLARE P : TIntPointer
OUTPUT P^
`;
    const result = await exec(program);
    expect(result.code).toBe('E3070');
    expect(result.errors[0]?.help).toContain('<- ^');
  });

  it('checks the pointer target type', async () => {
    const program = `
TYPE TIntPointer = ^INTEGER
DECLARE P : TIntPointer
DECLARE S : STRING
S <- "x"
P <- ^S
`;
    expect(await errorOf(program)).toBe('E3012');
  });

  it('rejects taking the address of an expression', async () => {
    expect(await errorOf('X <- 1\nY <- ^(X + 1)')).toBe('E2050');
  });

  it('rejects dereferencing something that is not a pointer', async () => {
    expect(await errorOf('X <- 1\nOUTPUT X^')).toBe('E3074');
  });
});

describe('sets', () => {
  it('type-checks the members against the base type', async () => {
    const program = `
TYPE LetterSet = SET OF CHAR
DEFINE Vowels ('A', 1) : LetterSet
`;
    expect(await errorOf(program)).toBe('E3096');
  });

  it('refuses an operation the guide does not define', async () => {
    const program = `
TYPE LetterSet = SET OF CHAR
DEFINE Vowels ('A','E') : LetterSet
DEFINE Others ('B') : LetterSet
OUTPUT Vowels + Others
`;
    const result = await exec(program);
    expect(result.code).toBe('E3060');
    expect(result.errors[0]?.help).toContain('no other set operations');
  });

  it('compares two sets regardless of order', async () => {
    const program = `
TYPE LetterSet = SET OF CHAR
DEFINE A ('A','E') : LetterSet
DEFINE B ('E','A') : LetterSet
OUTPUT A = B
`;
    expect(await outputOf(program)).toBe('TRUE\n');
  });

  it('reports DEFINE against a type that is not a set', async () => {
    const program = `
TYPE Season = (Spring, Summer)
DEFINE X ('A') : Season
`;
    expect(await errorOf(program)).toBe('E3061');
  });
});

describe('type declaration syntax', () => {
  it('rejects a malformed TYPE', async () => {
    const result = await exec('TYPE X = 5');
    expect(result.code).toBe('E2084');
    expect(result.errors[0]?.help).toContain('SET OF');
  });

  it('rejects a record body that is not a DECLARE', async () => {
    expect(await errorOf('TYPE X\n   OUTPUT 1\nENDTYPE')).toBe('E2012');
  });

  it('reports a missing ENDTYPE', async () => {
    expect(await errorOf('TYPE X\n   DECLARE A : INTEGER')).toBe('E2012');
  });

  it('reports a duplicate type', async () => {
    expect(await errorOf('TYPE X = (A)\nTYPE X = (B)')).toBe('E3003');
  });
});

import { describe, expect, it } from 'vitest';
import { errorOf, outputOf } from '../testing';

// M9 shipped the editor, and running the example programs through it exposed
// two gaps the earlier milestones had never exercised.

describe('the arrow character in every position that takes an arrow', () => {
  it('starts a FOR loop', async () => {
    expect(
      await outputOf(`
DECLARE Index : INTEGER
FOR Index ← 1 TO 3
   OUTPUT Index
NEXT Index
`),
    ).toBe('1\n2\n3\n');
  });

  it('starts a FOR loop with a STEP', async () => {
    expect(
      await outputOf(`
DECLARE Index : INTEGER
FOR Index ← 6 TO 2 STEP -2
   OUTPUT Index
NEXT Index
`),
    ).toBe('6\n4\n2\n');
  });

  it('assigns, and stores through a pointer', async () => {
    expect(
      await outputOf(`
TYPE IntPointer = ^INTEGER
DECLARE Value : INTEGER
DECLARE Address : IntPointer
Value ← 7
Address ← ^Value
Address^ ← Address^ + 1
OUTPUT Value
`),
    ).toBe('8\n');
  });

  it('still rejects `=` used as assignment in a FOR loop', async () => {
    expect(
      await errorOf(`
DECLARE Index : INTEGER
FOR Index = 1 TO 3
   OUTPUT Index
NEXT Index
`),
    ).toBe('E2001');
  });
});

const SHAPES = `
CLASS Shape
   PRIVATE Name : STRING
   PUBLIC PROCEDURE NEW(GivenName : STRING)
      Name <- GivenName
   ENDPROCEDURE
   PUBLIC PROCEDURE Describe()
      OUTPUT Name, " has area ", Area()
   ENDPROCEDURE
   PUBLIC FUNCTION Area() RETURNS REAL
      RETURN 0.0
   ENDFUNCTION
ENDCLASS

CLASS Rectangle INHERITS Shape
   PRIVATE Width : REAL
   PRIVATE Height : REAL
   PUBLIC PROCEDURE NEW(GivenWidth : REAL, GivenHeight : REAL)
      SUPER.NEW("Rectangle")
      Width <- GivenWidth
      Height <- GivenHeight
   ENDPROCEDURE
   PUBLIC FUNCTION Area() RETURNS REAL
      RETURN Width * Height
   ENDFUNCTION
ENDCLASS
`;

describe('a method calling another method of the same object', () => {
  it('resolves the call without a receiver', async () => {
    expect(
      await outputOf(`${SHAPES}
DECLARE Plain : Shape
Plain <- NEW Shape("Nothing")
Plain.Describe()
`),
    ).toBe('Nothing has area 0.0\n');
  });

  it('dispatches on the actual class, so an override wins', async () => {
    expect(
      await outputOf(`${SHAPES}
DECLARE Box : Rectangle
Box <- NEW Rectangle(3.0, 4.0)
Box.Describe()
`),
    ).toBe('Rectangle has area 12.0\n');
  });

  it('reaches a PRIVATE method of the same class', async () => {
    expect(
      await outputOf(`
CLASS Counter
   PRIVATE Total : INTEGER
   PUBLIC PROCEDURE NEW()
      Total <- 0
   ENDPROCEDURE
   PRIVATE PROCEDURE Bump()
      Total <- Total + 1
   ENDPROCEDURE
   PUBLIC PROCEDURE Add(Times : INTEGER)
      DECLARE Index : INTEGER
      FOR Index <- 1 TO Times
         CALL Bump()
      NEXT Index
   ENDPROCEDURE
   PUBLIC FUNCTION Value() RETURNS INTEGER
      RETURN Total
   ENDFUNCTION
ENDCLASS

DECLARE Tally : Counter
Tally <- NEW Counter()
Tally.Add(4)
OUTPUT Tally.Value()
`),
    ).toBe('4\n');
  });

  it('is a call to a method, not to a like-named global procedure', async () => {
    expect(
      await outputOf(`
PROCEDURE Report()
   OUTPUT "global"
ENDPROCEDURE

CLASS Thing
   PUBLIC PROCEDURE NEW()
   ENDPROCEDURE
   PUBLIC PROCEDURE Report()
      OUTPUT "method"
   ENDPROCEDURE
   PUBLIC PROCEDURE Go()
      CALL Report()
   ENDPROCEDURE
ENDCLASS

DECLARE Item : Thing
Item <- NEW Thing()
Item.Go()
CALL Report()
`),
    ).toBe('method\nglobal\n');
  });

  it('still reaches a global subprogram that no method shadows', async () => {
    expect(
      await outputOf(`
FUNCTION Double(Value : INTEGER) RETURNS INTEGER
   RETURN Value * 2
ENDFUNCTION

CLASS Thing
   PUBLIC PROCEDURE NEW()
   ENDPROCEDURE
   PUBLIC FUNCTION Four() RETURNS INTEGER
      RETURN Double(2)
   ENDFUNCTION
ENDCLASS

DECLARE Item : Thing
Item <- NEW Thing()
OUTPUT Item.Four()
`),
    ).toBe('4\n');
  });

  it('reports an unqualified PROCEDURE used as a function', async () => {
    expect(
      await errorOf(`
CLASS Thing
   PUBLIC PROCEDURE NEW()
   ENDPROCEDURE
   PUBLIC PROCEDURE Silent()
   ENDPROCEDURE
   PUBLIC FUNCTION Bad() RETURNS INTEGER
      RETURN Silent()
   ENDFUNCTION
ENDCLASS

DECLARE Item : Thing
Item <- NEW Thing()
OUTPUT Item.Bad()
`),
    ).toBe('E3105');
  });

  it('leaves an unknown name outside a class reported as before', async () => {
    expect(await errorOf('OUTPUT Missing(1)')).toBe('E3090');
  });
});

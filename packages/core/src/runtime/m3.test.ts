import { describe, expect, it } from 'vitest';
import { errorOf, exec, outputOf } from '../testing';

describe('M3 acceptance: the guide examples', () => {
  it('runs the nested IF example', async () => {
    const program = `
DECLARE ChallengerScore : INTEGER
DECLARE ChampionScore : INTEGER
DECLARE HighestScore : INTEGER
DECLARE ChallengerName : STRING
DECLARE ChampionName : STRING
ChallengerScore <- 90
ChampionScore <- 80
HighestScore <- 85
ChallengerName <- "Ali"
ChampionName <- "Bo"

IF ChallengerScore > ChampionScore THEN
   IF ChallengerScore > HighestScore THEN
      OUTPUT ChallengerName, " is champion and highest scorer"
   ELSE
      OUTPUT ChallengerName, " is the new champion"
   ENDIF
ELSE
   OUTPUT ChampionName, " is still the champion"
   IF ChampionScore > HighestScore THEN
      OUTPUT ChampionName, " is also the highest scorer"
   ENDIF
ENDIF
`;
    expect(await outputOf(program)).toBe('Ali is champion and highest scorer\n');
  });

  it('takes the ELSE branch and its nested IF', async () => {
    const program = `
ChallengerScore <- 50
ChampionScore <- 90
HighestScore <- 85
ChampionName <- "Bo"
IF ChallengerScore > ChampionScore THEN
   OUTPUT "new champion"
ELSE
   OUTPUT ChampionName, " is still the champion"
   IF ChampionScore > HighestScore THEN
      OUTPUT ChampionName, " is also the highest scorer"
   ENDIF
ENDIF
`;
    expect(await outputOf(program)).toBe('Bo is still the champion\nBo is also the highest scorer\n');
  });

  it('runs the WHILE digital-root example', async () => {
    const program = `
Number <- 47
WHILE Number > 9
   Number <- Number - 9
ENDWHILE
OUTPUT Number
`;
    expect(await outputOf(program)).toBe('2\n');
  });

  it('runs the REPEAT password example', async () => {
    const program = `
REPEAT
   OUTPUT "Please enter the password"
   INPUT Password
UNTIL Password = "Secret"
`;
    expect(await outputOf(program, ['wrong', 'Secret'])).toBe(
      'Please enter the password\nPlease enter the password\n',
    );
  });

  it('runs the CASE move example', async () => {
    // The guide's fragment omits the declaration; Move must be a CHAR for the
    // single-quoted cases to match.
    const program = `
DECLARE Move : CHAR
Position <- 50
INPUT Move
CASE OF Move
   'W' : Position <- Position - 10
   'S' : Position <- Position + 10
   'A' : Position <- Position - 1
   'D' : Position <- Position + 1
   OTHERWISE : OUTPUT "beep"
ENDCASE
OUTPUT Position
`;
    expect(await outputOf(program, ['W'])).toBe('40\n');
    expect(await outputOf(program, ['D'])).toBe('51\n');
    expect(await outputOf(program, ['Q'])).toBe('beep\n50\n');
  });
});

describe('FOR loops', () => {
  it('counts inclusively', async () => {
    expect(await outputOf('Total <- 0\nFOR i <- 1 TO 5\n   Total <- Total + i\nNEXT i\nOUTPUT Total')).toBe('15\n');
  });

  it('runs once when the bounds are equal', async () => {
    expect(await outputOf('FOR i <- 3 TO 3\n   OUTPUT i\nNEXT i')).toBe('3\n');
  });

  it('does not run when the start is past the end', async () => {
    expect(await outputOf('OUTPUT "before"\nFOR i <- 5 TO 1\n   OUTPUT i\nNEXT i\nOUTPUT "after"')).toBe(
      'before\nafter\n',
    );
  });

  it('counts down with a negative step', async () => {
    expect(await outputOf('FOR i <- 3 TO 1 STEP -1\n   OUTPUT i\nNEXT i')).toBe('3\n2\n1\n');
  });

  it('leaves the counter holding the value that failed the test', async () => {
    expect(await outputOf('FOR i <- 1 TO 3\nNEXT i\nOUTPUT i')).toBe('4\n');
  });

  it('evaluates the bounds once', async () => {
    const program = `
Limit <- 3
FOR i <- 1 TO Limit
   Limit <- 10
NEXT i
OUTPUT i
`;
    expect(await outputOf(program)).toBe('4\n');
  });

  it('runs the guide nested-FOR grand total', async () => {
    const program = `
DECLARE Amount : INTEGER
Total <- 0
MaxRow <- 2
FOR Row <- 1 TO MaxRow
   RowTotal <- 0
   FOR Column <- 1 TO 10
      RowTotal <- RowTotal + Column
   NEXT Column
   OUTPUT "Total for Row ", Row, " is ", RowTotal
   Total <- Total + RowTotal
NEXT Row
OUTPUT "The grand total is ", Total
`;
    expect(await outputOf(program)).toBe(
      'Total for Row 1 is 55\nTotal for Row 2 is 55\nThe grand total is 110\n',
    );
  });

  it('rejects a mismatched NEXT', async () => {
    expect(await errorOf('FOR i <- 1 TO 3\nNEXT j')).toBe('E2030');
  });

  it('rejects a zero step', async () => {
    expect(await errorOf('FOR i <- 1 TO 3 STEP 0\nNEXT i')).toBe('E3031');
  });

  it('rejects non-integer bounds', async () => {
    expect(await errorOf('FOR i <- 1.5 TO 3\nNEXT i')).toBe('E3030');
  });

  it('names the arrow when = is used for the start value', async () => {
    expect(await errorOf('FOR i = 1 TO 3\nNEXT i')).toBe('E2001');
  });
});

describe('CASE statements', () => {
  it('matches a range', async () => {
    const program = `
Mark <- 72
CASE OF Mark
   0 TO 49 : OUTPUT "fail"
   50 TO 69 : OUTPUT "pass"
   70 TO 100 : OUTPUT "distinction"
ENDCASE
`;
    expect(await outputOf(program)).toBe('distinction\n');
  });

  it('does nothing when nothing matches and there is no OTHERWISE', async () => {
    expect(await outputOf('X <- 9\nCASE OF X\n   1 : OUTPUT "one"\nENDCASE\nOUTPUT "done"')).toBe('done\n');
  });

  it('stops at the first matching case', async () => {
    const program = `
X <- 1
CASE OF X
   1 : OUTPUT "first"
   1 : OUTPUT "second"
ENDCASE
`;
    expect(await outputOf(program)).toBe('first\n');
  });

  it('allows several statements in one clause', async () => {
    const program = `
X <- 1
CASE OF X
   1 : OUTPUT "a"
       OUTPUT "b"
   2 : OUTPUT "c"
ENDCASE
`;
    expect(await outputOf(program)).toBe('a\nb\n');
  });

  it('rejects a case label that is not a literal', async () => {
    expect(await errorOf('Y <- 1\nX <- 1\nCASE OF X\n   Y : OUTPUT "no"\nENDCASE')).toBe('E2040');
  });

  it('rejects OTHERWISE that is not last', async () => {
    const program = `
X <- 1
CASE OF X
   OTHERWISE : OUTPUT "other"
   1 : OUTPUT "one"
ENDCASE
`;
    expect(await errorOf(program)).toBe('E2041');
  });

  it('rejects a label of the wrong type', async () => {
    expect(await errorOf('X <- 1\nCASE OF X\n   "a" : OUTPUT "no"\nENDCASE')).toBe('E3040');
  });

  it('explains the CHAR/STRING trap that the guide example falls into', async () => {
    const result = await exec("INPUT Move\nCASE OF Move\n   'W' : OUTPUT \"up\"\nENDCASE", ['W']);
    expect(result.code).toBe('E3040');
    expect(result.errors[0]?.help).toContain('declare it as a CHAR');
  });
});

describe('conditions', () => {
  it('requires a BOOLEAN condition', async () => {
    expect(await errorOf('IF 1 THEN\n   OUTPUT "x"\nENDIF')).toBe('E3098');
    expect(await errorOf('WHILE 1\nENDWHILE')).toBe('E3098');
  });
});

describe('unclosed blocks', () => {
  it('reports the opening line of a missing ENDIF', async () => {
    const result = await exec('IF TRUE THEN\n   OUTPUT "x"');
    expect(result.code).toBe('E2011');
    expect(result.errors[0]?.span.line).toBe(1);
    expect(result.errors[0]?.message).toContain('IF');
  });

  it('reports a missing ENDWHILE', async () => {
    expect(await errorOf('WHILE TRUE\n   OUTPUT "x"')).toBe('E2011');
  });

  it('reports a missing UNTIL', async () => {
    expect(await errorOf('REPEAT\n   OUTPUT "x"')).toBe('E2011');
  });
});

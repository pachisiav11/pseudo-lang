import { describe, expect, it } from 'vitest';
import { exec } from '../testing';

function files(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

describe('M7 acceptance: the guide examples', () => {
  it('copies a text file, replacing blank lines with dashes', async () => {
    const program = `
DECLARE LineOfText : STRING
OPENFILE "FileA.txt" FOR READ
OPENFILE "FileB.txt" FOR WRITE
WHILE NOT EOF("FileA.txt")
   READFILE "FileA.txt", LineOfText
   IF LineOfText = "" THEN
      WRITEFILE "FileB.txt", " ----------------------------"
   ELSE
      WRITEFILE "FileB.txt", LineOfText
   ENDIF
ENDWHILE
CLOSEFILE "FileA.txt"
CLOSEFILE "FileB.txt"
`;
    const result = await exec(
      program,
      [],
      {},
      files({ 'FileA.txt': 'first\n\nthird\n' }),
    );
    expect(result.ok).toBe(true);
    expect(result.host.fileContents('FileB.txt')).toBe(
      'first\n ----------------------------\nthird\n',
    );
  });

  it('runs the random-file record shuffle', async () => {
    const program = `
TYPE Student
   DECLARE LastName : STRING
   DECLARE FirstName : STRING
   DECLARE YearGroup : INTEGER
   DECLARE FormGroup : CHAR
ENDTYPE

DECLARE Pupil : Student
DECLARE NewPupil : Student
DECLARE Position : INTEGER

NewPupil.LastName <- "Johnson"
NewPupil.FirstName <- "Leroy"
NewPupil.YearGroup <- 6
NewPupil.FormGroup <- 'A'

OPENFILE "StudentFile.Dat" FOR RANDOM

DECLARE Filler : Student
FOR Position <- 10 TO 20
   Filler.LastName <- "Name"
   Filler.FirstName <- "First"
   Filler.YearGroup <- Position
   Filler.FormGroup <- 'B'
   SEEK "StudentFile.Dat", Position
   PUTRECORD "StudentFile.Dat", Filler
NEXT Position

FOR Position <- 20 TO 10 STEP -1
   SEEK "StudentFile.Dat", Position
   GETRECORD "StudentFile.Dat", Pupil
   SEEK "StudentFile.Dat", Position + 1
   PUTRECORD "StudentFile.Dat", Pupil
NEXT Position

SEEK "StudentFile.Dat", 10
PUTRECORD "StudentFile.Dat", NewPupil

SEEK "StudentFile.Dat", 10
GETRECORD "StudentFile.Dat", Pupil
OUTPUT Pupil.FirstName, " ", Pupil.LastName

SEEK "StudentFile.Dat", 21
GETRECORD "StudentFile.Dat", Pupil
OUTPUT Pupil.YearGroup

CLOSEFILE "StudentFile.Dat"
`;
    const result = await exec(program);
    expect(result.errors.map((e) => e.code)).toEqual([]);
    expect(result.output).toBe('Leroy Johnson\n20\n');
  });
});

describe('text files', () => {
  it('reports EOF correctly on an empty file', async () => {
    const program = `
OPENFILE "empty.txt" FOR READ
OUTPUT EOF("empty.txt")
CLOSEFILE "empty.txt"
`;
    const result = await exec(program, [], {}, files({ 'empty.txt': '' }));
    expect(result.output).toBe('TRUE\n');
  });

  it('truncates on WRITE even when nothing is written', async () => {
    const program = `
OPENFILE "log.txt" FOR WRITE
CLOSEFILE "log.txt"
`;
    const result = await exec(program, [], {}, files({ 'log.txt': 'old data\n' }));
    expect(result.host.fileContents('log.txt')).toBe('');
  });

  it('appends to an existing file', async () => {
    const program = `
OPENFILE "log.txt" FOR APPEND
WRITEFILE "log.txt", "new"
CLOSEFILE "log.txt"
`;
    const result = await exec(program, [], {}, files({ 'log.txt': 'old\n' }));
    expect(result.host.fileContents('log.txt')).toBe('old\nnew\n');
  });

  it('reports a missing file', async () => {
    const result = await exec('OPENFILE "nope.txt" FOR READ');
    expect(result.code).toBe('E3112');
  });

  it('refuses to open the same file twice', async () => {
    const program = `
OPENFILE "a.txt" FOR READ
OPENFILE "a.txt" FOR WRITE
`;
    const result = await exec(program, [], {}, files({ 'a.txt': 'x\n' }));
    expect(result.code).toBe('E3113');
    expect(result.errors[0]?.help).toContain('only one mode at a time');
  });

  it('refuses to write to a file opened for reading', async () => {
    const program = `
OPENFILE "a.txt" FOR READ
WRITEFILE "a.txt", "x"
`;
    const result = await exec(program, [], {}, files({ 'a.txt': 'x\n' }));
    expect(result.code).toBe('E3116');
  });

  it('refuses to read past the end of a file', async () => {
    const program = `
DECLARE L : STRING
OPENFILE "a.txt" FOR READ
READFILE "a.txt", L
READFILE "a.txt", L
`;
    const result = await exec(program, [], {}, files({ 'a.txt': 'only\n' }));
    expect(result.code).toBe('E3115');
    expect(result.errors[0]?.help).toContain('NOT EOF');
  });

  it('requires a STRING target for READFILE', async () => {
    const program = `
DECLARE N : INTEGER
OPENFILE "a.txt" FOR READ
READFILE "a.txt", N
`;
    const result = await exec(program, [], {}, files({ 'a.txt': 'x\n' }));
    expect(result.code).toBe('E3114');
  });

  it('requires a STRING file identifier', async () => {
    const result = await exec('OPENFILE 5 FOR READ');
    expect(result.code).toBe('E3111');
  });

  it('reports EOF on a file that is not open', async () => {
    expect((await exec('OUTPUT EOF("a.txt")')).code).toBe('E3116');
  });

  it('reports closing a file that is not open', async () => {
    expect((await exec('CLOSEFILE "a.txt"')).code).toBe('E3116');
  });

  it('flushes and warns about a file left open', async () => {
    const program = `
OPENFILE "out.txt" FOR WRITE
WRITEFILE "out.txt", "kept"
`;
    const result = await exec(program);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['W1001']);
    expect(result.host.fileContents('out.txt')).toBe('kept\n');
  });

  it('reads a file back after writing and closing it', async () => {
    const program = `
DECLARE L : STRING
OPENFILE "round.txt" FOR WRITE
WRITEFILE "round.txt", "hello"
CLOSEFILE "round.txt"
OPENFILE "round.txt" FOR READ
READFILE "round.txt", L
OUTPUT L
CLOSEFILE "round.txt"
`;
    const result = await exec(program);
    expect(result.output).toBe('hello\n');
  });
});

describe('random files', () => {
  const RECORD = `
TYPE Item
   DECLARE Name : STRING
   DECLARE Qty : INTEGER
ENDTYPE
`;

  it('requires SEEK before GETRECORD', async () => {
    const program = `${RECORD}
DECLARE I : Item
OPENFILE "f.dat" FOR RANDOM
GETRECORD "f.dat", I
`;
    const result = await exec(program);
    expect(result.code).toBe('E3120');
    expect(result.errors[0]?.help).toContain('SEEK');
  });

  it('reports an empty slot', async () => {
    const program = `${RECORD}
DECLARE I : Item
OPENFILE "f.dat" FOR RANDOM
SEEK "f.dat", 3
GETRECORD "f.dat", I
`;
    expect((await exec(program)).code).toBe('E3118');
  });

  it('reports a record that does not fit the slot size', async () => {
    const program = `${RECORD}
DECLARE I : Item
I.Name <- "a very long name indeed for such a tiny record slot"
I.Qty <- 1
OPENFILE "f.dat" FOR RANDOM
SEEK "f.dat", 1
PUTRECORD "f.dat", I
`;
    const result = await exec(program, [], { randomFileRecordSize: 32 });
    expect(result.code).toBe('E3117');
    expect(result.errors[0]?.help).toContain('randomFileRecordSize');
  });

  it('reports the wrong record type', async () => {
    const program = `${RECORD}
TYPE Other
   DECLARE Q : INTEGER
ENDTYPE
DECLARE I : Item
DECLARE O : Other
I.Name <- "x"
I.Qty <- 1
OPENFILE "f.dat" FOR RANDOM
SEEK "f.dat", 1
PUTRECORD "f.dat", I
SEEK "f.dat", 1
GETRECORD "f.dat", O
`;
    expect((await exec(program)).code).toBe('E3119');
  });

  it('rejects a record address below 1', async () => {
    const program = `${RECORD}
OPENFILE "f.dat" FOR RANDOM
SEEK "f.dat", 0
`;
    expect((await exec(program)).code).toBe('E3082');
  });

  it('refuses SEEK on a text file', async () => {
    const program = `
OPENFILE "a.txt" FOR READ
SEEK "a.txt", 1
`;
    const result = await exec(program, [], {}, files({ 'a.txt': 'x\n' }));
    expect(result.code).toBe('E3116');
  });

  it('round-trips every scalar field type', async () => {
    const program = `
TYPE All
   DECLARE I : INTEGER
   DECLARE R : REAL
   DECLARE S : STRING
   DECLARE C : CHAR
   DECLARE B : BOOLEAN
   DECLARE D : DATE
ENDTYPE
DECLARE Out : All
DECLARE In : All
Out.I <- 42
Out.R <- 3.5
Out.S <- "text"
Out.C <- 'z'
Out.B <- TRUE
Out.D <- 02/01/2005
OPENFILE "f.dat" FOR RANDOM
SEEK "f.dat", 1
PUTRECORD "f.dat", Out
SEEK "f.dat", 1
GETRECORD "f.dat", In
CLOSEFILE "f.dat"
OUTPUT In.I, " ", In.R, " ", In.S, " ", In.C, " ", In.B, " ", In.D
`;
    const result = await exec(program);
    expect(result.errors.map((e) => e.code)).toEqual([]);
    expect(result.output).toBe('42 3.5 text z TRUE 02/01/2005\n');
  });
});

import { describe, expect, it } from 'vitest';
import { errorOf, exec, outputOf } from '../testing';

const PET_AND_CAT = `
CLASS Pet
   PRIVATE Name : STRING
   PUBLIC PROCEDURE NEW(GivenName : STRING)
      Name <- GivenName
   ENDPROCEDURE
   PUBLIC FUNCTION GetName() RETURNS STRING
      RETURN Name
   ENDFUNCTION
ENDCLASS

CLASS Cat INHERITS Pet
   PRIVATE Breed : STRING
   PUBLIC PROCEDURE NEW(GivenName : STRING, GivenBreed : STRING)
      SUPER.NEW(GivenName)
      Breed <- GivenBreed
   ENDPROCEDURE
   PUBLIC FUNCTION GetBreed() RETURNS STRING
      RETURN Breed
   ENDFUNCTION
ENDCLASS
`;

describe('M8 acceptance: the guide examples', () => {
  it('runs the Pet and Cat example', async () => {
    const program = `${PET_AND_CAT}
DECLARE MyCat : Cat
MyCat <- NEW Cat("Kitty", "Shorthaired")
OUTPUT MyCat.GetName(), " is ", MyCat.GetBreed()
`;
    expect(await outputOf(program)).toBe('Kitty is Shorthaired\n');
  });

  it('runs the methods and properties example', async () => {
    // The guide marks GetAttempts PRIVATE and then calls it from outside,
    // which cannot both be true. Its prose rule wins, so this uses PUBLIC.
    const program = `
CLASS Game
   PRIVATE Attempts : INTEGER
   PUBLIC PROCEDURE NEW()
      Attempts <- 3
   ENDPROCEDURE
   PUBLIC PROCEDURE SetAttempts(Number : INTEGER)
      Attempts <- Number
   ENDPROCEDURE
   PUBLIC FUNCTION GetAttempts() RETURNS INTEGER
      RETURN Attempts
   ENDFUNCTION
ENDCLASS

DECLARE Player : Game
Player <- NEW Game()
OUTPUT Player.GetAttempts()
Player.SetAttempts(5)
OUTPUT Player.GetAttempts()
`;
    expect(await outputOf(program)).toBe('3\n5\n');
  });
});

describe('access control', () => {
  it('refuses to read a PRIVATE property from outside', async () => {
    const program = `${PET_AND_CAT}
DECLARE MyCat : Cat
MyCat <- NEW Cat("Kitty", "Shorthaired")
OUTPUT MyCat.Name
`;
    const result = await exec(program);
    expect(result.code).toBe('E3100');
    expect(result.errors[0]?.help).toContain('PUBLIC method');
  });

  it('refuses to call a PRIVATE method from outside', async () => {
    const program = `
CLASS C
   PUBLIC PROCEDURE NEW()
   ENDPROCEDURE
   PRIVATE PROCEDURE Secret()
      OUTPUT "hidden"
   ENDPROCEDURE
ENDCLASS
DECLARE X : C
X <- NEW C()
X.Secret()
`;
    expect(await errorOf(program)).toBe('E3100');
  });

  it('lets a subclass reach an inherited PRIVATE member', async () => {
    const program = `
CLASS Base
   PRIVATE Value : INTEGER
   PUBLIC PROCEDURE NEW()
      Value <- 7
   ENDPROCEDURE
ENDCLASS
CLASS Derived INHERITS Base
   PUBLIC PROCEDURE NEW()
      SUPER.NEW()
   ENDPROCEDURE
   PUBLIC FUNCTION Read() RETURNS INTEGER
      RETURN Value
   ENDFUNCTION
ENDCLASS
DECLARE D : Derived
D <- NEW Derived()
OUTPUT D.Read()
`;
    expect(await outputOf(program)).toBe('7\n');
  });

  it('treats a member with no keyword as PUBLIC', async () => {
    const program = `
CLASS C
   Value : INTEGER
   PUBLIC PROCEDURE NEW()
      Value <- 1
   ENDPROCEDURE
ENDCLASS
DECLARE X : C
X <- NEW C()
OUTPUT X.Value
`;
    expect(await outputOf(program)).toBe('1\n');
  });
});

describe('inheritance', () => {
  it('dispatches on the object actual class', async () => {
    const program = `
CLASS Animal
   PUBLIC PROCEDURE NEW()
   ENDPROCEDURE
   PUBLIC FUNCTION Speak() RETURNS STRING
      RETURN "..."
   ENDFUNCTION
ENDCLASS
CLASS Dog INHERITS Animal
   PUBLIC PROCEDURE NEW()
      SUPER.NEW()
   ENDPROCEDURE
   PUBLIC FUNCTION Speak() RETURNS STRING
      RETURN "Woof"
   ENDFUNCTION
ENDCLASS
DECLARE A : Animal
A <- NEW Dog()
OUTPUT A.Speak()
`;
    expect(await outputOf(program)).toBe('Woof\n');
  });

  it('calls the parent version through SUPER', async () => {
    const program = `
CLASS Animal
   PUBLIC PROCEDURE NEW()
   ENDPROCEDURE
   PUBLIC FUNCTION Speak() RETURNS STRING
      RETURN "generic"
   ENDFUNCTION
ENDCLASS
CLASS Dog INHERITS Animal
   PUBLIC PROCEDURE NEW()
      SUPER.NEW()
   ENDPROCEDURE
   PUBLIC FUNCTION Speak() RETURNS STRING
      RETURN SUPER.Speak() & " Woof"
   ENDFUNCTION
ENDCLASS
DECLARE D : Dog
D <- NEW Dog()
OUTPUT D.Speak()
`;
    expect(await outputOf(program)).toBe('generic Woof\n');
  });

  it('stores a subclass object in a parent-typed variable', async () => {
    const program = `${PET_AND_CAT}
DECLARE P : Pet
P <- NEW Cat("Kitty", "Shorthaired")
OUTPUT P.GetName()
`;
    expect(await outputOf(program)).toBe('Kitty\n');
  });

  it('refuses to store an unrelated object', async () => {
    const program = `${PET_AND_CAT}
CLASS Rock
   PUBLIC PROCEDURE NEW()
   ENDPROCEDURE
ENDCLASS
DECLARE P : Pet
P <- NEW Rock()
`;
    const result = await exec(program);
    expect(result.code).toBe('E3012');
    expect(result.errors[0]?.help).toContain('does not inherit');
  });

  it('reports an unknown parent class', async () => {
    expect(await errorOf('CLASS A INHERITS Missing\nENDCLASS')).toBe('E3101');
  });

  it('reports circular inheritance', async () => {
    const program = `
CLASS A INHERITS B
ENDCLASS
CLASS B INHERITS A
ENDCLASS
`;
    expect(await errorOf(program)).toBe('E3101');
  });
});

describe('objects', () => {
  it('assigns objects by reference', async () => {
    const program = `${PET_AND_CAT}
DECLARE A : Cat
DECLARE B : Cat
A <- NEW Cat("Kitty", "Shorthaired")
B <- A
OUTPUT B.GetName()
`;
    expect(await outputOf(program)).toBe('Kitty\n');
  });

  it('gives each object its own fields', async () => {
    const program = `${PET_AND_CAT}
DECLARE A : Cat
DECLARE B : Cat
A <- NEW Cat("One", "Tabby")
B <- NEW Cat("Two", "Siamese")
OUTPUT A.GetName(), " ", B.GetName()
`;
    expect(await outputOf(program)).toBe('One Two\n');
  });

  it('reports an unknown class', async () => {
    expect(await errorOf('X <- NEW Missing()')).toBe('E3101');
  });

  it('reports a class with no NEW', async () => {
    const program = `
CLASS C
   PUBLIC FUNCTION F() RETURNS INTEGER
      RETURN 1
   ENDFUNCTION
ENDCLASS
X <- NEW C()
`;
    const result = await exec(program);
    expect(result.code).toBe('E3102');
    expect(result.errors[0]?.help).toContain('PROCEDURE NEW');
  });

  it('reports an unknown method and lists the real ones', async () => {
    const program = `${PET_AND_CAT}
DECLARE MyCat : Cat
MyCat <- NEW Cat("Kitty", "Shorthaired")
OUTPUT MyCat.Fly()
`;
    const result = await exec(program);
    expect(result.code).toBe('E3073');
    expect(result.errors[0]?.help).toContain('GetBreed');
  });

  it('reports a method call on something that is not an object', async () => {
    expect(await errorOf('X <- 5\nX.Method()')).toBe('E3072');
  });

  it('reports SUPER outside a class', async () => {
    expect(await errorOf('SUPER.NEW()')).toBe('E3103');
  });

  it('reports SUPER in a class with no parent', async () => {
    const program = `
CLASS C
   PUBLIC PROCEDURE NEW()
      SUPER.NEW()
   ENDPROCEDURE
ENDCLASS
X <- NEW C()
`;
    const result = await exec(program);
    expect(result.code).toBe('E3104');
    expect(result.errors[0]?.help).toContain('INHERITS');
  });

  it('refuses a procedure-method used as a value', async () => {
    const program = `${PET_AND_CAT}
DECLARE MyCat : Cat
MyCat <- NEW Cat("Kitty", "Shorthaired")
DECLARE S : STRING
S <- MyCat.NEW("x")
`;
    expect(await errorOf(program)).toBe('E3105');
  });

  it('refuses a function-method used as a bare statement', async () => {
    const program = `${PET_AND_CAT}
DECLARE MyCat : Cat
MyCat <- NEW Cat("Kitty", "Shorthaired")
MyCat.GetName()
`;
    const result = await exec(program);
    expect(result.code).toBe('E3106');
    expect(result.errors[0]?.help).toContain('OUTPUT');
  });

  it('checks constructor arity', async () => {
    const program = `${PET_AND_CAT}
X <- NEW Cat("Kitty")
`;
    expect(await errorOf(program)).toBe('E3093');
  });

  it('refuses to output a whole object', async () => {
    const program = `${PET_AND_CAT}
DECLARE MyCat : Cat
MyCat <- NEW Cat("Kitty", "Shorthaired")
OUTPUT MyCat
`;
    expect(await errorOf(program)).toBe('E3050');
  });
});

# pseudo-lang — Build Guide

An executable specification for building **pseudo-lang**: an interpreter and VS Code extension for Cambridge International AS & A Level Computer Science **9618** pseudocode (syllabus for exams in 2027, 2028 and 2029).

This document is written to be followed step by step, by a human or by a coding agent. Every milestone ends with concrete acceptance tests. Where the Cambridge guide is silent or ambiguous, the decision taken here is marked **[DECISION]** and justified. Where this implementation intentionally departs from the guide, it is marked **[DEVIATION]**.

---

## Table of contents

1. [Goals and non-goals](#1-goals-and-non-goals)
2. [Ground truth and scope](#2-ground-truth-and-scope)
3. [Decisions the guide leaves open](#3-decisions-the-guide-leaves-open)
4. [Repository layout](#4-repository-layout)
5. [Prerequisites and bootstrap](#5-prerequisites-and-bootstrap)
6. [Milestone plan](#6-milestone-plan)
7. [Lexer specification](#7-lexer-specification)
8. [Grammar](#8-grammar)
9. [AST definitions](#9-ast-definitions)
10. [Parser specification](#10-parser-specification)
11. [Runtime value model](#11-runtime-value-model)
12. [Runtime semantics](#12-runtime-semantics)
13. [Standard library](#13-standard-library)
14. [File handling](#14-file-handling)
15. [Object-oriented programming](#15-object-oriented-programming)
16. [Diagnostics catalogue](#16-diagnostics-catalogue)
17. [The CLI package](#17-the-cli-package)
18. [The VS Code extension](#18-the-vs-code-extension)
19. [The debug adapter](#19-the-debug-adapter)
20. [Test strategy](#20-test-strategy)
21. [Packaging and distribution](#21-packaging-and-distribution)
22. [Appendix A — conformance programs](#appendix-a--conformance-programs)
23. [Appendix B — full keyword list](#appendix-b--full-keyword-list)

---

## 1. Goals and non-goals

### Goals

- Run `.pseudo` files that are written exactly as the Cambridge 9618 pseudocode guide specifies, with no translation step.
- Reject anything the guide does not define, and say precisely what was expected instead. A student who writes `Total = 0` should be told that `=` is a comparison operator and that assignment is `←` (or `<-`).
- Work inside VS Code: colouring, a Run command, and a real step debugger with breakpoints and a variables panel.
- Install from a `.vsix` built out of a public GitHub repository. No Marketplace account required.

### Non-goals

- No language server. Errors surface when the program is run, not while typing. (The architecture leaves room to add one later — see §6, M9.)
- No formatter.
- No transpilation to Python/Java/VB. This is an interpreter.
- No performance work beyond "fast enough for exam-sized programs". A tree-walking interpreter is correct here.

### Success criterion

Every code example printed in the Cambridge guide runs and produces the documented result. Those examples are transcribed in [Appendix A](#appendix-a--conformance-programs) and form the conformance suite.

---

## 2. Ground truth and scope

The single source of truth is `721401-2027-2029-pseudocode-guide.pdf`, sitting in the repository root. Keep it there and commit it — the spec must travel with the code.

The guide covers, and this implementation must therefore cover:

| § | Feature | Milestone |
|---|---------|-----------|
| 1 | Comments (`//`), indentation, case conventions | M1 |
| 2 | `INTEGER REAL CHAR STRING BOOLEAN DATE`, literals, identifiers, `DECLARE`, `CONSTANT`, assignment | M2 |
| 3 | 1-D and 2-D arrays, whole-array assignment | M4 |
| 4.1 | Enumerated types (`TYPE X = (a, b, c)`) | M6 |
| 4.1 | Pointer types (`TYPE X = ^INTEGER`) | M6 |
| 4.1 | Record types (`TYPE ... ENDTYPE`) | M6 |
| 4.1 | Set types (`TYPE X = SET OF T`, `DEFINE`) | M6 |
| 4.2 | Dot notation, whole-record assignment, deref `^` | M6 |
| 5.1 | `INPUT`, `OUTPUT` | M2 |
| 5.2 | `+ - * / DIV MOD` | M2 |
| 5.3 | `> < >= <= = <>` | M2 |
| 5.4 | `AND OR NOT` | M2 |
| 5.5 | `RIGHT LENGTH MID LCASE UCASE`, `&` | M5 |
| 5.6 | `INT RAND` | M5 |
| 6.1 | `IF / THEN / ELSE / ENDIF` | M3 |
| 6.2 | `CASE OF / OTHERWISE / ENDCASE`, ranges | M3 |
| 7.1 | `FOR / TO / STEP / NEXT` | M3 |
| 7.2 | `REPEAT / UNTIL` | M3 |
| 7.3 | `WHILE / ENDWHILE` | M3 |
| 8.1 | `PROCEDURE / ENDPROCEDURE`, `CALL` | M5 |
| 8.2 | `FUNCTION / RETURNS / RETURN / ENDFUNCTION` | M5 |
| 8.3 | `BYVAL`, `BYREF` | M5 |
| 9.1 | `OPENFILE FOR READ\|WRITE\|APPEND`, `READFILE`, `WRITEFILE`, `EOF`, `CLOSEFILE` | M7 |
| 9.2 | `OPENFILE FOR RANDOM`, `SEEK`, `GETRECORD`, `PUTRECORD` | M7 |
| 10 | `CLASS / ENDCLASS`, `PUBLIC`, `PRIVATE`, `NEW`, `INHERITS`, `SUPER` | M8 |

Nothing outside this table is in scope for v1.

### Known defects in the source guide

Two things in the PDF are wrong or under-specified. Do not replicate them.

1. **Section 4.2 pointer example.** The guide writes `MyPointer ← ^ThisSeason` where `MyPointer` is declared `TIntPointer` (a `^INTEGER`) but `ThisSeason` is of type `Season`. It then writes `NextSeason ← MyPointer^ + 1`, adding an integer to an enumerated value. This is type-incoherent. Implement pointers as specified in §4.1 and treat that example as illustrative prose, not a conformance test.
2. **Set operations.** The guide defines how to *declare* a set and how to `DEFINE` one, but defines no operations on sets at all. See [§3.11](#311-sets).

---

## 3. Decisions the guide leaves open

These are the design forks. Each is settled here so the implementation never has to guess.

### 3.1 Assignment operator

The guide's operator is `←` (U+2190 LEFTWARDS ARROW). That character is not on a keyboard.

**[DECISION]** The lexer accepts **both** `←` and the ASCII digraph `<-` as the assignment token. They are indistinguishable after lexing. `=` is **never** assignment; using it in statement position produces `E2001` naming the correct form. The extension ships a snippet and an optional keybinding that inserts `←`, and a setting `pseudoLang.insertArrowOnAssign` (default `true`) that rewrites a typed `<-` into `←` on save.

Rationale: exam-exactness on reading, keyboard-reachability on writing. Because `<-` is only ever produced by a human typing assignment, accepting it costs nothing in strictness.

### 3.2 Are declarations mandatory?

Section 2.4 says it is "good practice to declare variables explicitly". It does not say declaration is required — and the guide's own examples (`FOR Index ← 1 TO 30`, `Counter ← 0`) use undeclared variables.

**[DECISION]** Implicit declaration is **allowed by default**. On first assignment, an undeclared identifier is created in the current scope and takes the type of the assigned value. Reading an identifier that has never been assigned is `E3001` ("variable `X` is used before it is given a value").

A setting `pseudoLang.strictDeclarations` (default `false`) turns implicit declaration into `E3002`. Turn it on for exam discipline; leave it off to run the guide's own examples verbatim.

### 3.3 Case sensitivity of identifiers

Section 2.3: "Identifiers should be considered case insensitive, for example, `Countdown` and `CountDown` should not be used as separate variable names."

**[DECISION]** Identifiers are matched **case-insensitively**. The symbol table keys on the lower-cased name but stores the spelling from the declaration, so error messages and the debugger's variables panel show the identifier as the author wrote it. Declaring two identifiers that differ only in case in the same scope is `E3003`.

Keywords are matched **case-sensitively** and must be upper case. `if` is not `IF`; it lexes as an identifier and will fail in parsing with `E2010` ("`if` is not a keyword — pseudocode keywords are upper case, did you mean `IF`?").

### 3.4 Numeric type rules

- `INTEGER` is a JavaScript `number` constrained to integers. Any arithmetic result that is meant to be `INTEGER` but is not integral is a bug in the interpreter, not a silent truncation.
- `/` always produces `REAL`, even for integer operands (guide §5.2 states this explicitly). `7 / 2` is `3.5`; `6 / 2` is `3.0`, not `3`.
- `DIV` and `MOD` require both operands to be `INTEGER`. Otherwise `E3010`.
- `DIV` truncates toward zero. `MOD` returns a result with the sign of the dividend, matching the `a - (a DIV b) * b` identity. `-7 DIV 2` is `-3`; `-7 MOD 2` is `-1`. **[DECISION]** — the guide does not define behaviour for negative operands.
- Division or `DIV`/`MOD` by zero is `E3011`.
- **Widening:** an `INTEGER` operand in a mixed `INTEGER`/`REAL` expression widens to `REAL`. Assigning an `INTEGER` value to a `REAL` variable widens. Assigning a `REAL` value to an `INTEGER` variable is `E3012` — there is no implicit truncation; the program must call `INT`.

### 3.5 `CHAR` and `STRING`

`CHAR` is a distinct type holding exactly one character, written in single quotes. `STRING` is written in double quotes.

**[DECISION]** `&` (concatenation) accepts `STRING` or `CHAR` operands and always produces `STRING`. Everything else keeps them apart: comparing a `CHAR` with a `STRING` using `=` is `E3013`, and assigning a `CHAR` to a `STRING` variable is `E3012`.

Rationale: the guide's `LCASE`/`UCASE` take and return `CHAR`, so the types must stay distinct, but forbidding `"Row " & Grade` where `Grade` is a `CHAR` would break ordinary programs for no benefit.

### 3.6 `DATE` literals

`02/01/2005` is a date, but it also lexes as `02 / 01 / 2005` — three integers and two divisions.

**[DECISION]** The lexer emits a `DATE` literal when it matches `\d{2}/\d{2}/\d{4}` **with no whitespace between the parts**. Anything else is arithmetic. This is unambiguous in practice because:
- Integer literals in the guide are never zero-padded, so a real division would be written `12 / 5 / 2024` or `12/5/2024`, neither of which matches.
- Real literals always contain a decimal point, so they never appear in this shape.

Document this rule in the user-facing README. A date whose day/month/year do not form a valid calendar date is `E1010`. Dates print as `dd/mm/yyyy`.

No date arithmetic or date library functions exist — the guide defines none.

### 3.7 Scoping

The guide does not describe scope. **[DECISION]**

- There is one **global** scope, created at program start.
- Each `PROCEDURE`/`FUNCTION` **call** creates a fresh **local** scope containing its parameters and any variable declared or implicitly created inside it.
- Name resolution checks local, then global. Assignment to a name that exists globally but not locally writes the global. This matches how students expect pseudocode to behave and makes the guide's `Total` accumulator examples work.
- Procedures and functions may not be nested. A `PROCEDURE` inside a `PROCEDURE` is `E2020`.
- Recursion is supported. Depth is capped at `pseudoLang.maxCallDepth` (default 2000) to convert stack overflow into `E3020` with a call-stack trace.
- Class instances get an **object scope** — see [§15](#15-object-oriented-programming).

### 3.8 `FOR` loop semantics

Guide §7.1 gives the behaviour but not the evaluation order. **[DECISION]**

- The start, end, and `STEP` expressions are each evaluated **once**, at loop entry, in that order.
- All three must be `INTEGER`, else `E3030`.
- The control variable must be `INTEGER`. If it does not exist it is created (subject to §3.2).
- `STEP 0` is `E3031` — it would never terminate.
- Termination: with a positive step the loop runs while `i <= end`; with a negative step while `i >= end`.
- The control variable retains its final value after the loop, which is the first value that failed the test.
- Assigning to the control variable inside the body is allowed and affects iteration. The guide does not forbid it.
- `NEXT <identifier>` must name the same identifier as the `FOR`, else `E2030`. (The guide calls repeating it "good practice"; because omitting it is not shown anywhere in the guide, require it.)

### 3.9 `CASE` semantics

- Cases are tested in written order; the first match runs and control passes to after `ENDCASE`. No fall-through.
- Case labels must be **literals**, **constants**, or a `<literal> TO <literal>` range. Expressions involving variables are `E2040`. (Guide §6.2 shows only literals.)
- The selector and every label must be of the same type, else `E3040`. Ranges are valid for `INTEGER`, `CHAR` and `REAL`.
- `OTHERWISE` must be last, else `E2041`.
- If nothing matches and there is no `OTHERWISE`, the statement does nothing.

### 3.10 `INPUT` and `OUTPUT`

- `OUTPUT a, b, c` writes the values **concatenated with no separator**, followed by a newline. This matches the guide's `OUTPUT "You have ", Lives, " lives left"` which contains its own spaces.
- Value rendering: `INTEGER` plain (`42`); `REAL` with at least one digit each side of the point (`4.0`, `0.3`, `-4.0`) per §2.2; `BOOLEAN` as `TRUE`/`FALSE`; `CHAR` and `STRING` with no quotes; `DATE` as `dd/mm/yyyy`; enumerated values as the value name; arrays, records, sets and objects are `E3050` (the guide never outputs a composite).
- `INPUT X` reads one line from standard input and converts it to the **declared type of `X`**. If `X` has no declared type yet, it is created as `STRING`. A failed conversion is `E3051` and does not consume a retry — the program stops.
- End of input during `INPUT` is `E3052`.

### 3.11 Sets

The guide declares sets and defines set values but gives **no operations at all**.

**[DECISION]** v1 supports exactly:
- `TYPE <id> = SET OF <base type>` — declares the set type.
- `DEFINE <id> (v1, v2, ...) : <set type>` — creates a named constant set. Values must be literals of the base type.
- Assignment of a set value to a variable of that set type.
- `=` and `<>` between two sets of the same type (compares membership, order-insensitive).

Any other use of a set is `E3060` with the message "set operations beyond assignment and comparison are not defined in the 9618 pseudocode guide". Revisit if Cambridge publishes operations.

### 3.12 Pointers

- `TYPE T = ^BaseType` declares a pointer type.
- `^X` where `X` is an assignable location yields a pointer to that location. `^` applied to an expression is `E2050`.
- `P^` dereferences. Dereferencing a pointer that was never assigned is `E3070`.
- Pointers are implemented as references to the **storage cell**, so writing through `P^ ← v` updates the original variable, array element, or record field.
- The pointed-to type must match the pointer type, else `E3071`.
- There is no pointer arithmetic and no heap allocation — the guide describes neither.

### 3.13 Whole-structure assignment

Guide §3.2 allows `SavedGame ← NoughtsAndCrosses` for arrays of the same size and type, and §4.2 allows `Pupil2 ← Pupil1` for records.

**[DECISION]** These are **deep copies**, not aliases. Arrays must match in element type and in every bound, else `E3080`. Records must be of the same declared type, else `E3081`. Objects assign by **reference**, not by copy — an object variable holds a reference (this is the only reference-semantics type besides pointers).

### 3.14 Built-in functions not in the guide

Past papers commonly use `LEFT`, `TO_UPPER`, `NUM_TO_STRING`, `STRING_TO_NUM` and similar. The guide defines only `RIGHT`, `LENGTH`, `MID`, `LCASE`, `UCASE`, `INT`, `RAND`, `EOF`.

**[DECISION]** Only the eight guide functions exist. Calling anything else is `E3090`, whose help names all eight and points out that an exam question defines any others it uses. There is no opt-in extension set: a student who can call `LEFT` here and not in the exam has been taught the wrong thing, and a question that defines an extra function defines it in pseudocode, which this already runs.

### 3.15 Strings are 1-indexed

`MID("ABCDEFGH", 2, 3)` returns `"BCD"` — position 2 is `B`. String positions are **1-based** throughout. Out-of-range positions or lengths are `E3091`.

---

## 4. Repository layout

A pnpm workspace with three packages. The extension bundles `core`; `cli` exists so the language is usable outside VS Code and so the conformance suite can run headless.

```
pseudo-lang/
├─ 721401-2027-2029-pseudocode-guide.pdf   # the spec — keep in repo
├─ package.json                            # workspace root, scripts only
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ vitest.config.ts                        # workspace-wide test config
├─ .editorconfig
├─ .gitignore
├─ .github/workflows/ci.yml
├─ .github/workflows/release.yml
├─ README.md
├─ BUILD_GUIDE.md                          # this file
├─ CHANGELOG.md
├─ todo.md
├─ TODO_log.md
│
├─ packages/
│  ├─ core/                                # @pseudo-lang/core
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ src/
│  │     ├─ index.ts                       # public API surface
│  │     ├─ lexer/
│  │     │  ├─ token.ts                    # TokenKind, Token, Span
│  │     │  ├─ keywords.ts                 # the keyword table
│  │     │  └─ lexer.ts
│  │     ├─ parser/
│  │     │  ├─ ast.ts                      # every node type
│  │     │  ├─ parser.ts                   # statements + declarations
│  │     │  └─ expression.ts               # precedence climbing
│  │     ├─ runtime/
│  │     │  ├─ value.ts                    # PValue tagged union
│  │     │  ├─ types.ts                    # PType, type equality, widening
│  │     │  ├─ cell.ts                     # storage cells (for BYREF/pointers)
│  │     │  ├─ scope.ts                    # Scope, CallStack
│  │     │  ├─ interpreter.ts              # the tree walker
│  │     │  ├─ operators.ts                # binary/unary dispatch
│  │     │  ├─ builtins.ts                 # the eight guide functions
│  │     │  ├─ extra-builtins.ts           # opt-in, §3.14
│  │     │  ├─ files.ts                    # text + random file handles
│  │     │  └─ objects.ts                  # class model, method dispatch
│  │     ├─ diagnostics/
│  │     │  ├─ codes.ts                    # the error catalogue
│  │     │  └─ error.ts                    # PseudoError, formatting
│  │     └─ host.ts                        # Host interface: io, fs, debug hook
│  │
│  ├─ cli/                                 # @pseudo-lang/cli — bin: `pseudo`
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ src/
│  │     ├─ main.ts
│  │     └─ node-host.ts                   # Host backed by stdio + fs
│  │
│  └─ vscode/                              # the extension, name: pseudo-lang
│     ├─ package.json                      # contributes: language, grammar, debugger
│     ├─ tsconfig.json
│     ├─ esbuild.mjs
│     ├─ language-configuration.json
│     ├─ syntaxes/pseudocode.tmLanguage.json
│     ├─ snippets/pseudocode.json
│     ├─ icons/
│     └─ src/
│        ├─ extension.ts                   # activate, commands
│        ├─ run.ts                         # the Run command
│        ├─ debug/
│        │  ├─ factory.ts                  # inline DAP factory
│        │  ├─ session.ts                  # DebugSession subclass
│        │  └─ vscode-host.ts              # Host backed by the debug session
│        └─ config.ts
│
└─ tests/
   ├─ conformance/                         # Appendix A, one dir per example
   │  └─ <name>/{program.pseudo, stdin.txt, expected.txt}
   ├─ errors/                              # one file per diagnostic code
   │  └─ <code>/{program.pseudo, expected.txt}
   └─ runner.ts
```

---

## 5. Prerequisites and bootstrap

- Node.js 20 LTS or newer.
- pnpm 9 (`corepack enable && corepack prepare pnpm@latest --activate`).
- VS Code 1.90 or newer.
- `@vscode/vsce` for packaging (invoked via `pnpm dlx`, not installed globally).

Bootstrap commands:

```bash
mkdir pseudo-lang && cd pseudo-lang && git init && pnpm init
```

```bash
pnpm add -D typescript vitest @types/node esbuild
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

`tsconfig.base.json` — the settings that matter:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`noUncheckedIndexedAccess` is deliberate. It forces every array-bounds and token-lookahead access to be checked, which is exactly the class of bug an interpreter is prone to.

Root `package.json` scripts:

```json
{
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "test:watch": "vitest",
    "package": "pnpm -C packages/vscode package"
  }
}
```

---

## 6. Milestone plan

Each milestone is independently testable. Do not start the next one until the previous one's acceptance tests pass. Total estimate assumes focused work.

| # | Milestone | Delivers | Est. |
|---|-----------|----------|------|
| M0 | Skeleton | Workspace, three packages, `pseudo run` prints "no statements", CI green | 0.5 d |
| M1 | Lexer | Every token in [§7](#7-lexer-specification), comments, spans, `E1xxx` errors | 1 d |
| M2 | Expressions and assignment | Literals, operators, `DECLARE`, `CONSTANT`, `←`, `OUTPUT`, `INPUT`. First runnable programs | 1.5 d |
| M3 | Control flow | `IF`, `CASE`, `FOR`, `REPEAT`, `WHILE` | 1 d |
| M4 | Arrays | 1-D and 2-D, bounds checking, whole-array assignment | 0.5 d |
| M5 | Subprograms and library | `PROCEDURE`, `FUNCTION`, `CALL`, `RETURN`, `BYVAL`/`BYREF`, the eight built-ins | 1.5 d |
| M6 | User-defined types | `TYPE` record/enum/pointer/set, `DEFINE`, dot notation, `^` | 1.5 d |
| M7 | File handling | Text files, random files, `EOF` | 1 d |
| M8 | OOP | `CLASS`, `INHERITS`, `NEW`, `SUPER`, `PUBLIC`/`PRIVATE` | 1.5 d |
| M9 | VS Code extension | Grammar, Run command, snippets, `.vsix` | 1.5 d |
| M10 | Debugger | DAP: breakpoints, step, variables, call stack, `INPUT` prompts | 2 d |
| M11 | Polish and release | README, conformance suite complete, GitHub release workflow | 1 d |

Milestones M1–M8 need no VS Code at all. Build and test them entirely through `pseudo run` and the CLI. This keeps the feedback loop fast and the core package free of editor dependencies — a hard rule: **`packages/core` must never import `vscode`.**

### Acceptance test per milestone

**M0** — `pnpm build && node packages/cli/dist/main.js --version` prints a version.

**M1** — lexing this input produces the listed tokens with correct 1-based line/column:

```
// a comment
DECLARE Total : INTEGER
Total <- 4.0 + 'x'
```
→ `DECLARE, IDENT(Total), COLON, INTEGER, NEWLINE, IDENT(Total), ASSIGN, REAL(4.0), PLUS, CHAR(x), NEWLINE, EOF`

**M2** — this runs and prints `Penalty is 13.0`:

```
CONSTANT Rate = 6.50
DECLARE Hours : INTEGER
Hours <- 2
OUTPUT "Penalty is ", Hours * Rate
```

**M3** — the nested `IF` example and the `WHILE Number > 9` example from the guide both produce the documented output.

**M4** — the nested `FOR` grand-total example from §7.1 runs against a seeded 2-D array.

**M5** — `FUNCTION Max` from §8.2 and `PROCEDURE SWAP(BYREF X : INTEGER, Y : INTEGER)` from §8.3 both behave as documented. Critically: after `CALL SWAP(A, B)`, **both** have changed. Guide §8.3 states that "if there are several parameters passed by the same method, the `BYVAL` or `BYREF` keyword need not be repeated", so `Y` inherits `BYREF` from `X` — which is the only reading under which `SWAP` actually swaps. **[DECISION]** The parameter-passing mode is sticky: it starts as `BYVAL` and changes only when a `BYVAL`/`BYREF` keyword appears.

**M6** — the `StudentRecord` example from §4.2 runs, including `Pupil2 ← Pupil1` deep copy and `Form[Index].YearGroup ← Form[Index].YearGroup + 1`.

**M7** — the `FileA.txt` → `FileB.txt` copy example from §9.1 produces the documented file, and the `StudentFile.Dat` record-shuffle example from §9.2 completes.

**M8** — the `Pet` / `Cat INHERITS Pet` example from §10.2 constructs an object and `Player.GetAttempts()` returns the value set through `Player.SetAttempts(5)`. Accessing `Name` from outside the class raises `E3100`.

**M9** — `.vsix` installs; a `.pseudo` file is coloured; `Ctrl+F5` runs it in the terminal.

**M10** — a breakpoint on line 3 of a 5-line program stops execution, the variables panel shows correct values, step-over advances one line, continue finishes.

---

## 7. Lexer specification

### 7.1 Token kinds

```ts
export type TokenKind =
  // literals
  | 'INT_LIT' | 'REAL_LIT' | 'STRING_LIT' | 'CHAR_LIT' | 'DATE_LIT'
  // identifiers and keywords
  | 'IDENT' | 'KEYWORD'
  // operators
  | 'ASSIGN'                                  // ← or <-
  | 'PLUS' | 'MINUS' | 'STAR' | 'SLASH'
  | 'AMP'                                     // &
  | 'CARET'                                   // ^
  | 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE'
  // punctuation
  | 'LPAREN' | 'RPAREN' | 'LBRACKET' | 'RBRACKET'
  | 'COMMA' | 'COLON' | 'DOT'
  // structure
  | 'NEWLINE' | 'EOF';
```

Every token carries a `Span`:

```ts
export interface Span { line: number; col: number; endLine: number; endCol: number; }
export interface Token { kind: TokenKind; text: string; span: Span; value?: LiteralValue; }
```

Lines and columns are **1-based**. The debugger and every diagnostic depend on this; get it right in M1 and never convert.

### 7.2 Scanning rules, in order

1. **Whitespace** — spaces and tabs are skipped and are not significant. Indentation is presentational only ([guide §1.2](#2-ground-truth-and-scope)); the parser uses keywords like `ENDIF` to find block ends, never indentation.
2. **Line endings** — `\r\n`, `\n` and `\r` all produce one `NEWLINE` token. Consecutive newlines collapse to a single `NEWLINE`, and leading newlines at the start of a file are dropped. This lets the parser treat `NEWLINE` as a statement terminator without special-casing blank lines.
3. **Comments** — `//` to end of line, discarded. The `NEWLINE` that follows is still emitted.
4. **Line continuation** — the guide shows `FUNCTION` headers wrapped across lines (§8.2). **[DECISION]** A newline is suppressed when the preceding token is `COMMA`, `LPAREN`, or any binary operator. This makes wrapped parameter lists and long expressions work without an explicit continuation character, matching what the guide prints.
5. **`DATE_LIT`** — `\d{2}/\d{2}/\d{4}` with no internal whitespace. Validate as a calendar date; invalid → `E1010`. See [§3.6](#36-date-literals).
6. **`REAL_LIT`** — `\d+\.\d+`. At least one digit on each side, per guide §2.2. `4.` and `.7` are `E1011`.
7. **`INT_LIT`** — `\d+`. Note: negative numbers are *unary minus applied to a literal*, not part of the literal. This matters for `-7 MOD 2`.
8. **`STRING_LIT`** — `"..."`. **[DECISION]** No escape sequences — the guide defines none. A `"` inside a string is impossible; an unterminated string at end of line is `E1012`. The empty string `""` is valid.
9. **`CHAR_LIT`** — `'x'`, exactly one character between the quotes. Zero or more than one → `E1013`.
10. **`ASSIGN`** — `←` (U+2190) or `<-`. Scan `<-` before `<`, and `<=` and `<>` before `<`. Order matters: try `<-`, `<=`, `<>`, then `<`.
11. **Identifier or keyword** — `[A-Za-z][A-Za-z0-9_]*`. Look the exact text up in the keyword table ([Appendix B](#appendix-b--full-keyword-list)); a case-sensitive hit produces `KEYWORD`, otherwise `IDENT`. An identifier starting with a digit is `E1014`; an identifier containing an accented letter is `E1015` (guide §2.3 forbids them by name, so give the specific message).
12. **Multi-word keywords** — `CASE OF`, `SET OF`, `FOR ... TO`, `END...` variants. **[DECISION]** Do not try to lex these as single tokens. Emit `CASE` and `OF` separately and let the parser require the pair. It keeps the lexer context-free.
13. Anything else → `E1001` "unexpected character".

### 7.3 Keyword table

Store as a `Set<string>` built from the list in [Appendix B](#appendix-b--full-keyword-list). Two auxiliary sets are useful downstream:

- `TYPE_KEYWORDS` = `INTEGER REAL CHAR STRING BOOLEAN DATE ARRAY`
- `BLOCK_END_KEYWORDS` = `ENDIF ENDCASE ENDWHILE ENDPROCEDURE ENDFUNCTION ENDTYPE ENDCLASS UNTIL NEXT ELSE OTHERWISE`

The parser uses `BLOCK_END_KEYWORDS` to decide when a statement list has ended, and to produce good "missing `ENDIF`" errors.

---

## 8. Grammar

EBNF. `{ }` means zero or more, `[ ]` means optional, `|` means alternative. `NL` is the `NEWLINE` token.

```ebnf
program        = { NL } { statement } EOF ;

statement      = ( declaration
                 | constantDecl
                 | typeDecl
                 | defineDecl
                 | assignment
                 | inputStmt
                 | outputStmt
                 | ifStmt
                 | caseStmt
                 | forStmt
                 | repeatStmt
                 | whileStmt
                 | procedureDecl
                 | functionDecl
                 | callStmt
                 | returnStmt
                 | classDecl
                 | fileStmt
                 | methodCallStmt ) NL ;

(* --- declarations --- *)
declaration    = "DECLARE" ident ":" typeRef ;
constantDecl   = "CONSTANT" ident "=" literal ;

typeRef        = "INTEGER" | "REAL" | "CHAR" | "STRING" | "BOOLEAN" | "DATE"
               | arrayType
               | ident ;                                  (* user-defined *)

arrayType      = "ARRAY" "[" bound ":" bound
                 [ "," bound ":" bound ] "]" "OF" typeRef ;
bound          = expression ;                             (* must yield INTEGER *)

typeDecl       = recordType | enumType | pointerType | setType ;
recordType     = "TYPE" ident NL { declaration NL } "ENDTYPE" ;
enumType       = "TYPE" ident "=" "(" ident { "," ident } ")" ;
pointerType    = "TYPE" ident "=" "^" typeRef ;
setType        = "TYPE" ident "=" "SET" "OF" typeRef ;
defineDecl     = "DEFINE" ident "(" [ literal { "," literal } ] ")" ":" ident ;

(* --- statements --- *)
assignment     = lvalue ASSIGN expression ;
lvalue         = ident { lvalueSuffix } ;
lvalueSuffix   = "[" expression [ "," expression ] "]"    (* array index   *)
               | "." ident                                (* field/member  *)
               | "^" ;                                    (* dereference   *)

inputStmt      = "INPUT" lvalue ;
outputStmt     = "OUTPUT" expression { "," expression } ;

ifStmt         = "IF" expression [ NL ] "THEN" NL
                   statementList
                 [ "ELSE" NL statementList ]
                 "ENDIF" ;

caseStmt       = "CASE" "OF" expression NL
                   { caseClause }
                 [ "OTHERWISE" ":" caseBody ]
                 "ENDCASE" ;
caseClause     = caseLabel [ "TO" caseLabel ] ":" caseBody ;
caseLabel      = literal | ident ;                        (* constant only *)
caseBody       = statement { statement } ;

forStmt        = "FOR" ident ASSIGN expression "TO" expression
                 [ "STEP" expression ] NL
                   statementList
                 "NEXT" ident ;

repeatStmt     = "REPEAT" NL statementList "UNTIL" expression ;
whileStmt      = "WHILE" expression NL statementList "ENDWHILE" ;

(* --- subprograms --- *)
procedureDecl  = "PROCEDURE" ident "(" [ paramList ] ")" NL
                   statementList
                 "ENDPROCEDURE" ;
functionDecl   = "FUNCTION" ident "(" [ paramList ] ")" "RETURNS" typeRef NL
                   statementList
                 "ENDFUNCTION" ;
paramList      = param { "," param } ;
param          = [ "BYVAL" | "BYREF" ] ident ":" typeRef ;

callStmt       = "CALL" ident "(" [ argList ] ")" ;
methodCallStmt = ident "." ident "(" [ argList ] ")" ;
returnStmt     = "RETURN" [ expression ] ;
argList        = expression { "," expression } ;

(* --- classes --- *)
classDecl      = "CLASS" ident [ "INHERITS" ident ] NL
                   { classMember NL }
                 "ENDCLASS" ;
classMember    = access ( ident ":" typeRef | procedureDecl | functionDecl ) ;
access         = [ "PUBLIC" | "PRIVATE" ] ;

(* --- files --- *)
fileStmt       = "OPENFILE" expression "FOR" fileMode
               | "READFILE"  expression "," lvalue
               | "WRITEFILE" expression "," expression
               | "CLOSEFILE" expression
               | "SEEK"      expression "," expression
               | "GETRECORD" expression "," lvalue
               | "PUTRECORD" expression "," expression ;
fileMode       = "READ" | "WRITE" | "APPEND" | "RANDOM" ;

(* --- expressions, lowest precedence first --- *)
expression     = orExpr ;
orExpr         = andExpr    { "OR"  andExpr } ;
andExpr        = notExpr    { "AND" notExpr } ;
notExpr        = [ "NOT" ] relExpr ;
relExpr        = addExpr    [ ( "=" | "<>" | "<" | "<=" | ">" | ">=" ) addExpr ] ;
addExpr        = mulExpr    { ( "+" | "-" | "&" ) mulExpr } ;
mulExpr        = unaryExpr  { ( "*" | "/" | "DIV" | "MOD" ) unaryExpr } ;
unaryExpr      = [ "-" | "^" ] postfixExpr ;              (* ^ = address-of *)
postfixExpr    = primary { "[" expression [ "," expression ] "]"
                         | "." ident [ "(" [ argList ] ")" ]
                         | "^" } ;                        (* ^ = dereference *)
primary        = literal
               | "NEW" ident "(" [ argList ] ")"
               | ident [ "(" [ argList ] ")" ]            (* function call *)
               | "(" expression ")" ;

literal        = INT_LIT | REAL_LIT | STRING_LIT | CHAR_LIT | DATE_LIT
               | "TRUE" | "FALSE" ;
```

### Precedence table

Highest binds tightest.

| Level | Operators | Associativity |
|-------|-----------|---------------|
| 1 | postfix `[]`, `.`, `^` (deref), call | left |
| 2 | unary `-`, prefix `^` (address-of) | right |
| 3 | `*` `/` `DIV` `MOD` | left |
| 4 | `+` `-` `&` | left |
| 5 | `=` `<>` `<` `<=` `>` `>=` | non-associative |
| 6 | `NOT` | right |
| 7 | `AND` | left |
| 8 | `OR` | left |

Two notes. **[DECISION]** `&` sits with `+`/`-` — the guide does not state its precedence, and this is the conventional choice. **[DECISION]** Relational operators are non-associative: `a < b < c` is `E2060` rather than silently parsing as `(a < b) < c`, which would be a type error anyway and produces a worse message.

`NOT` binds *looser* than the relational operators so that `NOT X = Y` parses as `NOT (X = Y)`, which is what a reader expects. This differs from C-family languages; state it in the README.

---

## 9. AST definitions

`packages/core/src/parser/ast.ts`. Every node carries a `span` for diagnostics and breakpoints.

```ts
export interface Node { readonly kind: string; readonly span: Span; }

// ---- type references ----
export type TypeRef =
  | { kind: 'PrimitiveType'; name: 'INTEGER'|'REAL'|'CHAR'|'STRING'|'BOOLEAN'|'DATE'; span: Span }
  | { kind: 'ArrayType'; dims: [Expr, Expr][]; element: TypeRef; span: Span }
  | { kind: 'NamedType'; name: string; span: Span };

// ---- expressions ----
export type Expr =
  | { kind: 'IntLit';    value: number; span: Span }
  | { kind: 'RealLit';   value: number; span: Span }
  | { kind: 'StringLit'; value: string; span: Span }
  | { kind: 'CharLit';   value: string; span: Span }
  | { kind: 'BoolLit';   value: boolean; span: Span }
  | { kind: 'DateLit';   day: number; month: number; year: number; span: Span }
  | { kind: 'Ident';     name: string; span: Span }
  | { kind: 'Binary';    op: BinOp; left: Expr; right: Expr; span: Span }
  | { kind: 'Unary';     op: 'NEG'|'NOT'|'ADDR'; operand: Expr; span: Span }
  | { kind: 'Index';     target: Expr; indices: Expr[]; span: Span }
  | { kind: 'Member';    target: Expr; field: string; span: Span }
  | { kind: 'Deref';     target: Expr; span: Span }
  | { kind: 'Call';      callee: string; args: Expr[]; span: Span }
  | { kind: 'MethodCall'; target: Expr; method: string; args: Expr[]; span: Span }
  | { kind: 'New';       className: string; args: Expr[]; span: Span };

export type BinOp =
  | 'ADD'|'SUB'|'MUL'|'DIV_REAL'|'DIV_INT'|'MOD'|'CONCAT'
  | 'EQ'|'NEQ'|'LT'|'LTE'|'GT'|'GTE'|'AND'|'OR';

// ---- statements ----
export type Stmt =
  | { kind: 'Declare';   name: string; typeRef: TypeRef; span: Span }
  | { kind: 'Constant';  name: string; value: Expr; span: Span }
  | { kind: 'Assign';    target: Expr; value: Expr; span: Span }   // target is an lvalue Expr
  | { kind: 'Input';     target: Expr; span: Span }
  | { kind: 'Output';    values: Expr[]; span: Span }
  | { kind: 'If';        cond: Expr; then: Stmt[]; else?: Stmt[]; span: Span }
  | { kind: 'Case';      selector: Expr; clauses: CaseClause[]; otherwise?: Stmt[]; span: Span }
  | { kind: 'For';       varName: string; from: Expr; to: Expr; step?: Expr; body: Stmt[]; span: Span }
  | { kind: 'Repeat';    body: Stmt[]; until: Expr; span: Span }
  | { kind: 'While';     cond: Expr; body: Stmt[]; span: Span }
  | { kind: 'ProcDecl';  decl: SubprogramDecl; span: Span }
  | { kind: 'FuncDecl';  decl: SubprogramDecl; span: Span }
  | { kind: 'CallStmt';  callee: string; args: Expr[]; span: Span }
  | { kind: 'MethodCallStmt'; target: Expr; method: string; args: Expr[]; span: Span }
  | { kind: 'Return';    value?: Expr; span: Span }
  | { kind: 'TypeDecl';  decl: TypeDeclaration; span: Span }
  | { kind: 'Define';    name: string; values: Expr[]; setType: string; span: Span }
  | { kind: 'ClassDecl'; decl: ClassDeclaration; span: Span }
  | { kind: 'FileStmt';  op: FileOp; args: Expr[]; target?: Expr; mode?: FileMode; span: Span };

export interface CaseClause { from: Expr; to?: Expr; body: Stmt[]; span: Span }

export interface SubprogramDecl {
  name: string;
  params: Param[];
  returns?: TypeRef;          // present iff function
  body: Stmt[];
  access?: 'PUBLIC' | 'PRIVATE';
  span: Span;
}
export interface Param { name: string; typeRef: TypeRef; byRef: boolean; span: Span }

export type TypeDeclaration =
  | { kind: 'Record';  name: string; fields: { name: string; typeRef: TypeRef }[]; span: Span }
  | { kind: 'Enum';    name: string; values: string[]; span: Span }
  | { kind: 'Pointer'; name: string; target: TypeRef; span: Span }
  | { kind: 'Set';     name: string; base: TypeRef; span: Span };

export interface ClassDeclaration {
  name: string;
  inherits?: string;
  fields: { name: string; typeRef: TypeRef; access: 'PUBLIC'|'PRIVATE' }[];
  methods: SubprogramDecl[];
  span: Span;
}

export type FileOp = 'OPEN'|'READ'|'WRITE'|'CLOSE'|'SEEK'|'GETRECORD'|'PUTRECORD';
export type FileMode = 'READ'|'WRITE'|'APPEND'|'RANDOM';
```

`Assign.target` is an `Expr` restricted to `Ident | Index | Member | Deref`. Validate that restriction in the parser and report `E2070` otherwise — this gives a far better message than discovering it at runtime.

---

## 10. Parser specification

A hand-written recursive-descent parser with precedence climbing for expressions. No parser generator: the grammar is small, and hand-writing it is the only way to get the error messages this project needs.

### 10.1 Shape

```ts
class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private diag: DiagnosticSink) {}

  private peek(offset = 0): Token
  private check(kind: TokenKind, text?: string): boolean
  private match(kind: TokenKind, text?: string): boolean      // consume if match
  private expect(kind: TokenKind, text: string, code: DiagCode): Token
  private skipNewlines(): void
  private atBlockEnd(): boolean                               // BLOCK_END_KEYWORDS or EOF
}
```

### 10.2 Statement dispatch

`parseStatement()` switches on `peek()`:

- `KEYWORD` → dispatch on the keyword text.
- `IDENT` → could be an assignment (`X ← ...`, `A[i] ← ...`, `R.f ← ...`, `P^ ← ...`) or a bare method call (`Player.SetAttempts(5)`). Parse an lvalue-or-postfix expression first, then look at the next token: `ASSIGN` → assignment; `LPAREN` already consumed as part of a `MethodCall` → method call statement; anything else → `E2001`.
- Anything else → `E2002` "expected a statement".

This ordering is what makes `E2001` possible. When the parser sees `Total = 0`, it has already parsed `Total` as an lvalue and finds `EQ` where it wanted `ASSIGN`. Emit:

```
E2001  Total = 0
             ^
       `=` compares two values; it does not assign.
       To assign, write:  Total <- 0
```

### 10.3 Statement lists and block ends

`parseStatementList()` loops until `atBlockEnd()`. When the enclosing construct then fails to find its terminator, report against the **opening** token, not the end of file:

```
E2011  IF statement opened on line 12 is never closed
       expected ENDIF before end of file
```

Track open blocks on a stack so this message is always available. This single behaviour accounts for most of the practical value of the error messages — the common student mistake is a missing `ENDIF`/`NEXT`/`ENDWHILE`.

### 10.4 Error recovery

Panic-mode recovery at statement level: on error, record the diagnostic, then skip tokens until the next `NEWLINE`, and resume. This lets one run report several syntax errors. Cap reported syntax errors at 25 and then stop with "too many errors".

Do **not** attempt recovery inside an expression. A malformed expression produces one diagnostic and skips the line.

### 10.5 Expression parsing

Precedence climbing over the table in [§8](#precedence-table).

```ts
parseExpr(minPrec = 0): Expr {
  let left = parseUnary();
  for (;;) {
    const op = peekBinaryOp();
    if (!op || precedence(op) < minPrec) break;
    if (isNonAssociative(op) && lastWasSameLevel) throw E2060;
    consume();
    const right = parseExpr(precedence(op) + 1);   // all binary ops are left-assoc
    left = { kind: 'Binary', op, left, right, span: merge(left.span, right.span) };
  }
  return left;
}
```

The one subtlety is `^`. It is prefix (address-of) in `unaryExpr` and postfix (dereference) in `postfixExpr`. Resolve by position: if `^` appears where a *value* is expected, it is address-of; if it appears after a complete postfix expression, it is dereference. Recursive descent handles this naturally because the two are parsed in different functions.

`NOT` is handled at its own precedence level (6), between the relational operators and `AND`, per [§8](#precedence-table).

---

## 11. Runtime value model

`packages/core/src/runtime/value.ts`.

```ts
export type PValue =
  | { t: 'INTEGER'; v: number }
  | { t: 'REAL';    v: number }
  | { t: 'CHAR';    v: string }              // exactly one character
  | { t: 'STRING';  v: string }
  | { t: 'BOOLEAN'; v: boolean }
  | { t: 'DATE';    day: number; month: number; year: number }
  | { t: 'ARRAY';   arr: ArrayValue }
  | { t: 'RECORD';  typeName: string; fields: Map<string, Cell> }
  | { t: 'ENUM';    typeName: string; name: string; ordinal: number }
  | { t: 'SET';     typeName: string; members: PValue[] }
  | { t: 'POINTER'; typeName: string; cell: Cell | null }
  | { t: 'OBJECT';  obj: ObjectValue };

export interface ArrayValue {
  dims: { lower: number; upper: number }[];   // 1 or 2 entries
  element: PType;
  cells: Cell[];                              // row-major, dense
}
```

### 11.1 Cells

A `Cell` is a mutable box holding one `PValue` plus the type it was declared with. Everything that can be assigned to is a `Cell`. This is the single most important design choice in the runtime, because it makes `BYREF` and pointers fall out for free — both are just a second reference to an existing `Cell`.

```ts
export class Cell {
  constructor(
    public declared: PType,          // the declared type; drives assignment checking
    public value: PValue | undefined, // undefined = declared but never assigned
    public readonly name: string,     // original spelling, for the debugger
  ) {}
}
```

`value === undefined` is how `E3001` ("used before it is given a value") is detected. Do not initialise cells to zero — the guide never promises a default value, and catching the mistake is more useful.

Array elements are `Cell`s, so `^Scores[3]` and `BYREF Scores[3]` both work. Record fields are `Cell`s for the same reason.

### 11.2 Types

```ts
export type PType =
  | { k: 'INTEGER' } | { k: 'REAL' } | { k: 'CHAR' } | { k: 'STRING' }
  | { k: 'BOOLEAN' } | { k: 'DATE' }
  | { k: 'ARRAY'; dims: { lower: number; upper: number }[]; element: PType }
  | { k: 'RECORD'; name: string }
  | { k: 'ENUM'; name: string }
  | { k: 'SET'; name: string; base: PType }
  | { k: 'POINTER'; name: string; target: PType }
  | { k: 'CLASS'; name: string };
```

Two operations on types drive the whole runtime:

**`assignable(declared: PType, value: PValue): boolean`** — may this value be stored in a cell of this type?
- Identical types: yes.
- `INTEGER` value into `REAL` cell: yes (widen; convert the stored value to `{t:'REAL'}`).
- `REAL` value into `INTEGER` cell: **no** → `E3012`.
- `CHAR` into `STRING`: no. `STRING` into `CHAR`: no.
- `ARRAY` into `ARRAY`: only if element types are identical and every bound matches → else `E3080`.
- `RECORD` into `RECORD`: only if `name` matches → else `E3081`.
- `OBJECT` into `CLASS` cell: yes if the object's class is the cell's class or a subclass of it.
- Everything else: no.

**`commonNumeric(a, b)`** — for binary arithmetic, returns `REAL` if either side is `REAL`, else `INTEGER`.

### 11.3 Scopes

```ts
export class Scope {
  private cells = new Map<string, Cell>();     // key: name.toLowerCase()
  constructor(readonly parent: Scope | null, readonly kind: 'global'|'local'|'object') {}
  lookup(name: string): Cell | undefined       // this scope, then parent chain
  declare(name: string, type: PType): Cell     // E3003 on duplicate in this scope
}
```

Resolution order inside a method is: object scope → local scope → global scope. Wait — that is wrong and worth stating explicitly: it is **local → object → global**, so a parameter named `Name` shadows a field named `Name`. The guide's `PROCEDURE NEW(GivenName : STRING)` example deliberately renames the parameter to avoid the clash, which suggests Cambridge expects shadowing to be avoidable rather than defined. Pick local-first and document it.

Constants live in the scope where they are declared and their `Cell` is flagged read-only. Assigning to one is `E3004`.

---

## 12. Runtime semantics

`packages/core/src/runtime/interpreter.ts`.

### 12.1 The interpreter must be async

This is the decision that makes M10 possible, so make it in M2 and never revisit.

```ts
async execStmt(node: Stmt, scope: Scope): Promise<void> {
  await this.host.beforeStatement(node, this.callStack);   // debug hook + cancellation
  switch (node.kind) { /* ... */ }
}
```

Every statement execution awaits a `beforeStatement` hook on the `Host`. In the CLI that hook returns immediately. In the debugger it is where the session parks when the user is stepping or a breakpoint hits. Making the interpreter async from the start avoids a rewrite later — retrofitting async into a synchronous tree walker touches every function.

The same applies to `INPUT`, which awaits `host.readLine()`, and to `OUTPUT`, which awaits `host.write()`.

Expression evaluation is also async, because a function call inside an expression can execute statements, which can hit a breakpoint.

### 12.2 The Host interface

`packages/core/src/host.ts` is the only seam between the language and its environment. Core has no other I/O.

```ts
export interface Host {
  write(text: string): Promise<void>;
  readLine(): Promise<string | null>;          // null at end of input
  beforeStatement(node: Stmt, stack: readonly Frame[]): Promise<void>;
  fs: {
    readFileLines(path: string): Promise<string[]>;
    writeFile(path: string, data: string, append: boolean): Promise<void>;
    readRecordFile(path: string): Promise<Buffer>;
    writeRecordFile(path: string, data: Buffer): Promise<void>;
    exists(path: string): Promise<boolean>;
  };
  random(): number;                            // injectable, so RAND is testable
  resolvePath(relative: string): string;        // relative to the .pseudo file
}
```

Two implementations: `NodeHost` in the CLI, `DebugHost` in the extension. Tests use a `TestHost` that captures output into an array and feeds input from a fixed list — that is what makes the conformance suite trivial to write.

### 12.3 Assignment

```
1. Resolve the target to a Cell (creating it if the target is a bare identifier
   that does not exist and strictDeclarations is off).
2. Evaluate the value expression.
3. Check assignable(cell.declared, value). Fail -> E3012 / E3080 / E3081.
4. If widening INTEGER -> REAL, convert.
5. If the value is an ARRAY or RECORD, deep copy it (see 3.13).
6. Store.
```

Resolving an lvalue to a `Cell`:

| Target form | Resolution |
|-------------|------------|
| `X` | scope lookup, or create |
| `A[i]` / `A[i,j]` | evaluate indices, bounds-check → `E3082`, return `arr.cells[offset]` |
| `R.f` | resolve `R` to a cell, require `RECORD` or `OBJECT`, return the field cell |
| `P^` | resolve `P`, require `POINTER`, require non-null → `E3070`, return `ptr.cell` |

Array offset for a 2-D array with dims `[l1:u1, l2:u2]`: `(i - l1) * (u2 - l2 + 1) + (j - l2)`.

### 12.4 Subprogram calls

```
1. Look up the subprogram. Not found -> E3092.
2. Arity check -> E3093 with expected/actual counts.
3. Create a fresh local Scope whose parent is global.
4. For each parameter:
     BYVAL -> evaluate the argument, type-check against the parameter type,
              create a NEW Cell in the local scope holding a deep copy.
     BYREF -> resolve the argument as an lvalue to its Cell. If the argument
              is not an lvalue -> E3094 ("BYREF parameter X requires a
              variable, not an expression"). Bind that same Cell into the
              local scope under the parameter name.
5. Push a Frame onto the call stack (name, span, scope) for the debugger.
6. Execute the body.
7. Pop the frame.
```

`RETURN` is implemented as a control-flow exception (`ReturnSignal` carrying the value) caught by the function-call machinery. A `RETURN` inside a `PROCEDURE` is `E2080` — the guide only gives `RETURN` to functions. A function that finishes without executing `RETURN` is `E3095`.

**Functions may not take `BYREF` parameters** — guide §8.3 states this. Enforce at parse time: `E2081`.

**Functions must be called in an expression, never with `CALL`; procedures must be called with `CALL`.** Guide §8.2 is explicit. `CALL Max(1,2)` is `E2082`; a bare `Square(100)` statement is `E2083` ("procedures are called with `CALL Square(100)`"). The one exception is a method call on an object, which the guide writes without `CALL` (§10.1).

### 12.5 Control-flow signals

Use exception classes, not return codes: `ReturnSignal`, and internally `HaltSignal` for a clean stop from the debugger. Do not add `BREAK`/`CONTINUE` — the guide has neither.

---

## 13. Standard library

Exactly eight functions ([§3.14](#314-built-in-functions-not-in-the-guide)). Implement in `builtins.ts` as a table so arity and type checking are uniform.

| Signature | Behaviour | Errors |
|-----------|-----------|--------|
| `RIGHT(ThisString : STRING, x : INTEGER) RETURNS STRING` | rightmost `x` characters | `x < 0` or `x > LENGTH` → `E3091` |
| `LENGTH(ThisString : STRING) RETURNS INTEGER` | character count | — |
| `MID(ThisString : STRING, x : INTEGER, y : INTEGER) RETURNS STRING` | `y` characters starting at 1-based position `x` | `x < 1`, `y < 0`, or `x+y-1 > LENGTH` → `E3091` |
| `LCASE(ThisChar : CHAR) RETURNS CHAR` | lower-case equivalent; non-upper-case returned unchanged | wrong arg type → `E3096` |
| `UCASE(ThisChar : CHAR) RETURNS CHAR` | upper-case equivalent; non-lower-case returned unchanged | wrong arg type → `E3096` |
| `INT(x : REAL) RETURNS INTEGER` | integer part (truncate toward zero) | — |
| `RAND(x : INTEGER) RETURNS REAL` | random real in `[0, x)` | `x <= 0` → `E3097` |
| `EOF(<file identifier>) RETURNS BOOLEAN` | true if no more lines to read | file not open in `READ` mode → `E3110` |

Notes:
- `LENGTH` accepts `STRING` only. `LENGTH` of an array is **not** in the guide.
- `INT(27.5415)` is `27`; `INT(-27.5)` is `-27` (truncate toward zero, matching `DIV`).
- `RAND` takes its randomness from `host.random()` so tests can seed it.
- `EOF` is listed in guide §9.1 as a function, so it is called in expression position like any other.

Seven of these accept `STRING`/`CHAR`/`REAL`/`INTEGER` exactly; because `INTEGER` widens to `REAL`, `INT(5)` is legal and returns `5`.

---

## 14. File handling

`packages/core/src/runtime/files.ts`. A `FileTable` maps the **file identifier string** (not a handle) to an open-file record, because the guide identifies files by name in every operation.

```ts
interface OpenFile {
  path: string;                 // resolved absolute path
  mode: FileMode;
  lines?: string[];             // READ mode: whole file, split
  cursor?: number;              // READ mode: next line index
  pending?: string[];           // WRITE/APPEND: buffered output
  buffer?: Buffer;              // RANDOM: whole file
  recordPointer?: number;       // RANDOM: 1-based record index, set by SEEK
  recordType?: PType;           // RANDOM: inferred from first GET/PUT
}
```

### 14.1 Text files

- `OPENFILE <expr> FOR READ` — the expression must evaluate to `STRING` (`E3111`). Read the whole file, split on `\r\n|\n|\r`. A trailing newline does not produce a final empty line. Missing file → `E3112`. Already open → `E3113` ("a file should be opened in only one mode at a time", guide §9.1).
- `OPENFILE ... FOR WRITE` — truncate on open (guide: "any existing data in the file will be lost").
- `OPENFILE ... FOR APPEND` — create if absent, append otherwise.
- `READFILE <file>, <var>` — the variable must be `STRING` (`E3114`). Reading past the last line → `E3115`.
- `WRITEFILE <file>, <expr>` — writes the rendered value plus a newline. Rendering uses the same rules as `OUTPUT` ([§3.10](#310-input-and-output)).
- `CLOSEFILE <file>` — flush and remove from the table. Closing a file that is not open → `E3116`.
- **[DECISION]** Any file left open when the program ends is flushed and closed automatically, and a warning is printed. Losing a student's output to a forgotten `CLOSEFILE` teaches nothing useful.

Relative paths resolve against the directory of the `.pseudo` file, via `host.resolvePath`. Document this.

### 14.2 Random files

The guide describes random files as "records of fixed length" with a movable pointer, and defines `SEEK`, `GETRECORD`, `PUTRECORD` — but specifies **no on-disk format**. So the format is implementation-defined.

**[DECISION]** Format: a flat file of fixed-size slots.

- Slot size is `pseudoLang.randomFileRecordSize`, default **512 bytes**.
- Slot *n* (1-based, matching `SEEK`) occupies bytes `[(n-1) * size, n * size)`.
- Each slot holds a UTF-8 JSON encoding of the record, right-padded with `0x20` spaces. An all-space slot means "empty".
- `PUTRECORD` that would exceed the current file length extends the file with empty slots.
- A record whose JSON exceeds the slot size → `E3117` naming the record size setting.
- `GETRECORD` on an empty slot → `E3118`.
- `GETRECORD` requires the target variable's type to match the type recorded in the JSON (`{"__type":"StudentRecord", ...}`) → `E3119`.

This format is human-inspectable, which matters for teaching, and round-trips exactly. State plainly in the README that random files written by pseudo-lang are not compatible with any other tool — the guide defines no interchange format, so none can exist.

`SEEK` before the first `GETRECORD`/`PUTRECORD` is required; using them with no pointer set → `E3120`.

---

## 15. Object-oriented programming

### 15.1 Class model

```ts
export interface ClassInfo {
  name: string;
  parent: ClassInfo | null;
  fields: Map<string, { type: PType; access: 'PUBLIC'|'PRIVATE' }>;   // own fields only
  methods: Map<string, { decl: SubprogramDecl; access: 'PUBLIC'|'PRIVATE'; owner: ClassInfo }>;
}
export interface ObjectValue { cls: ClassInfo; fields: Map<string, Cell>; }
```

Field and method lookup walks the parent chain. A subclass method with the same name as a parent method **overrides** it — the guide does not discuss overriding, but `SUPER.NEW` only makes sense if it does. **[DECISION]** Dynamic dispatch on the object's actual class.

### 15.2 Construction

`X ← NEW Cat("Kitty", "Shorthaired")`:

```
1. Look up class Cat -> E3101 if unknown.
2. Allocate an ObjectValue with a Cell for every field, own and inherited,
   each undefined.
3. Find the NEW method on Cat, or inherited. None -> E3102.
4. Arity/type check the arguments.
5. Create a local scope for NEW; create an object scope holding the field cells;
   bind `SUPER` and the implicit receiver.
6. Execute NEW's body.
7. The value of the expression is the ObjectValue.
```

`SUPER.NEW(args)` invokes the parent's `NEW` against the **same** object. `SUPER.<Method>(args)` calls the parent's implementation, bypassing dispatch. `SUPER` outside a class → `E3103`; `SUPER` in a class with no `INHERITS` → `E3104`.

### 15.3 Access control

`PRIVATE` members are reachable only from code lexically inside the declaring class **or a subclass of it**. The guide shows a `PRIVATE FUNCTION GetAttempts()` that is clearly intended to be called from outside in the very next line (`OUTPUT Player.GetAttempts()`) — that is an inconsistency in the guide's example. **[DECISION]** Enforce the rule as written in the prose (§10.1: "assumed to be public unless otherwise stated"), and treat that example's `PRIVATE` as a typo for `PUBLIC`. Violations are `E3100` with a message pointing at the declaration line.

Members declared with no access keyword are `PUBLIC`.

### 15.4 Method calls

- As a statement: `Player.SetAttempts(5)` — no `CALL`, per guide §10.1.
- In an expression: `OUTPUT Player.GetAttempts()`.
- Calling a procedure-method in expression position → `E3105`; using a function-method as a bare statement → `E3106`.

**[DECISION]** An unqualified `Name(...)` written **inside a method body** resolves to a method of the current object if the object's class has one, and only otherwise to a global subprogram.

The guide always spells method calls `Object.Method(...)`, and 9618 has no `THIS` or `SELF` keyword. Taken literally, that leaves no spelling at all for one method calling another on the same object — a program that any student would write, with no correct form to redirect them to. Since guide §10.1 already resolves *fields* unqualified inside a method (`Attempts ← Number`), methods follow the same rule, including the shadowing that implies.

Resolution details:

- Dispatch is on the object's **actual** class, so a subclass override wins — the same rule as the qualified path.
- Access control still applies. The check is against the class that owns the *currently running* method, so a parent's code cannot reach a child's `PRIVATE` override; that is `E3100`.
- `CALL Name(...)` inside a method finds a method first too, and reports `E2082` if that method is a `FUNCTION`.
- Outside a class nothing changes: an unknown name is still `E3090`.

Note that `CALL Object.Method(...)` remains a syntax error. The guide shows the qualified form without `CALL`, so that is the only accepted spelling.

---

## 16. Diagnostics catalogue

`packages/core/src/diagnostics/codes.ts`. Every error has a stable code, a one-line summary, and a hint. The rendered form:

```
error[E2001]: `=` cannot be used to assign a value
  --> volume.pseudo:7:7
   |
 7 | Total = 0
   |       ^ this is a comparison operator
   |
help: assignment in 9618 pseudocode is written with a left arrow
      Total <- 0
```

Implement the renderer once, in `error.ts`, taking `(code, span, sourceLines, primaryLabel, help)`. It is used by the CLI, and the extension parses the same output to place problem markers.

### Code ranges

| Range | Phase |
|-------|-------|
| `E1xxx` | Lexical |
| `E2xxx` | Syntax |
| `E3xxx` | Runtime (includes type errors, since typing is runtime-only) |
| `W1xxx` | Warnings (never fatal) |

### Codes referenced by this guide

**Lexical**
`E1001` unexpected character ·
`E1010` invalid calendar date ·
`E1011` malformed real literal ·
`E1012` unterminated string ·
`E1013` character literal must contain exactly one character ·
`E1014` identifier starts with a digit ·
`E1015` accented letters are not allowed in identifiers

**Syntax**
`E2001` `=` used as assignment ·
`E2002` expected a statement ·
`E2010` lower-case keyword ·
`E2011` unclosed block ·
`E2020` nested subprogram ·
`E2030` `NEXT` identifier does not match `FOR` ·
`E2040` case label is not a constant ·
`E2041` `OTHERWISE` is not last ·
`E2050` `^` applied to a non-location ·
`E2060` chained relational operator ·
`E2070` invalid assignment target ·
`E2080` `RETURN` inside a procedure ·
`E2081` function parameter declared `BYREF` ·
`E2082` `CALL` used with a function ·
`E2083` procedure called without `CALL`

**Runtime**
`E3001` variable used before assignment ·
`E3002` undeclared variable (strict mode) ·
`E3003` duplicate declaration ·
`E3004` assignment to a constant ·
`E3010` `DIV`/`MOD` on non-integers ·
`E3011` division by zero ·
`E3012` type mismatch in assignment ·
`E3013` comparison between incompatible types ·
`E3020` call depth exceeded ·
`E3030` non-integer `FOR` bound ·
`E3031` `STEP 0` ·
`E3040` `CASE` label type mismatch ·
`E3050` cannot output a composite value ·
`E3051` input could not be converted ·
`E3052` unexpected end of input ·
`E3060` undefined set operation ·
`E3070` dereference of an unset pointer ·
`E3071` pointer target type mismatch ·
`E3080` array shape mismatch in assignment ·
`E3081` record type mismatch in assignment ·
`E3082` array index out of bounds ·
`E3090` unknown function ·
`E3091` string position out of range ·
`E3092` unknown subprogram ·
`E3093` wrong number of arguments ·
`E3094` `BYREF` argument is not a variable ·
`E3095` function ended without `RETURN` ·
`E3096` built-in argument type mismatch ·
`E3097` `RAND` argument must be positive ·
`E3100` access to a `PRIVATE` member ·
`E3101` unknown class ·
`E3102` class has no `NEW` ·
`E3103` `SUPER` outside a class ·
`E3104` `SUPER` with no parent class ·
`E3105` procedure-method used as a value ·
`E3106` function-method used as a statement ·
`E3110`–`E3120` file errors (see [§14](#14-file-handling))

**Warnings**
`W1001` file left open at program end ·
`W1002` variable declared but never used ·
`W1003` identifier differs from an existing one only by case

`E3082` deserves special care since it is the most common runtime error students hit. Include the actual index and the declared bounds:

```
error[E3082]: array index 31 is outside the bounds of `StudentNames`
  --> class.pseudo:14:14
   |
14 |    StudentNames[Index] <- ""
   |                 ^^^^^ Index is 31
   |
help: StudentNames was declared as ARRAY[1:30] OF STRING on line 2
```

---

## 17. The CLI package

`packages/cli`. `bin` entry `pseudo`.

```
pseudo run <file.pseudo> [--strict-declarations] [--seed <n>] [--max-depth <n>]
pseudo check <file.pseudo>          # parse only, report diagnostics, no execution
pseudo tokens <file.pseudo>         # debug aid: dump the token stream
pseudo ast <file.pseudo>            # debug aid: dump the AST as JSON
pseudo --version
```

`tokens` and `ast` exist for your own debugging during M1–M6 and cost almost nothing. Keep them.

Exit codes: `0` success, `1` diagnostics reported, `2` internal error (an interpreter bug — print a stack trace and ask for a GitHub issue).

`--seed` makes `RAND` deterministic, which the conformance suite needs.

`NodeHost` reads `INPUT` from stdin line by line. When stdin is a TTY, print the prompt-free read directly; when it is piped, just consume lines. Do not invent a prompt string — the guide's programs print their own with `OUTPUT`.

---

## 18. The VS Code extension

`packages/vscode`. Name `pseudo-lang`, display name **"Pseudocode (Cambridge 9618)"**.

### 18.1 `package.json` contributions

```jsonc
{
  "name": "pseudo-lang",
  "displayName": "Pseudocode (Cambridge 9618)",
  "engines": { "vscode": "^1.90.0" },
  "categories": ["Programming Languages", "Debuggers"],
  "activationEvents": ["onDebugResolve:pseudo"],
  "main": "./dist/extension.js",
  "contributes": {
    "languages": [{
      "id": "pseudocode",
      "aliases": ["Pseudocode", "pseudocode"],
      "extensions": [".pseudo"],
      "configuration": "./language-configuration.json",
      "icon": { "light": "./icons/file-light.svg", "dark": "./icons/file-dark.svg" }
    }],
    "grammars": [{
      "language": "pseudocode",
      "scopeName": "source.pseudocode",
      "path": "./syntaxes/pseudocode.tmLanguage.json"
    }],
    "snippets": [{ "language": "pseudocode", "path": "./snippets/pseudocode.json" }],
    "commands": [
      { "command": "pseudoLang.run", "title": "Pseudocode: Run File", "icon": "$(play)" },
      { "command": "pseudoLang.check", "title": "Pseudocode: Check File" },
      { "command": "pseudoLang.insertArrow", "title": "Pseudocode: Insert Assignment Arrow" }
    ],
    "menus": {
      "editor/title/run": [
        { "command": "pseudoLang.run", "when": "resourceLangId == pseudocode", "group": "navigation" }
      ]
    },
    "keybindings": [
      { "command": "pseudoLang.insertArrow", "key": "alt+-", "when": "editorTextFocus && resourceLangId == pseudocode" }
    ],
    "breakpoints": [{ "language": "pseudocode" }],
    "debuggers": [{
      "type": "pseudo",
      "label": "Pseudocode",
      "languages": ["pseudocode"],
      "configurationAttributes": {
        "launch": {
          "required": ["program"],
          "properties": {
            "program": { "type": "string", "default": "${file}" },
            "stopOnEntry": { "type": "boolean", "default": false },
            "strictDeclarations": { "type": "boolean", "default": false }
          }
        }
      },
      "initialConfigurations": [
        { "type": "pseudo", "request": "launch", "name": "Run pseudocode file", "program": "${file}" }
      ]
    }],
    "configuration": {
      "title": "Pseudocode",
      "properties": {
        "pseudoLang.strictDeclarations": { "type": "boolean", "default": false },
        "pseudoLang.insertArrowOnAssign": { "type": "boolean", "default": true },
        "pseudoLang.maxCallDepth": { "type": "number", "default": 2000 },
        "pseudoLang.randomFileRecordSize": { "type": "number", "default": 512 },
        "pseudoLang.extraBuiltins": { "type": "array", "default": [] }
      }
    }
  }
}
```

`activationEvents` is minimal because `contributes.languages` and `contributes.debuggers` activate implicitly in modern VS Code.

### 18.2 Language configuration

`language-configuration.json`:

```json
{
  "comments": { "lineComment": "//" },
  "brackets": [["(", ")"], ["[", "]"]],
  "autoClosingPairs": [
    { "open": "(", "close": ")" },
    { "open": "[", "close": "]" },
    { "open": "\"", "close": "\"", "notIn": ["string"] },
    { "open": "'", "close": "'", "notIn": ["string"] }
  ],
  "indentationRules": {
    "increaseIndentPattern": "^\\s*(IF\\b.*\\bTHEN|ELSE|WHILE\\b|REPEAT\\b|FOR\\b|PROCEDURE\\b|FUNCTION\\b|CASE\\s+OF\\b|TYPE\\s+\\w+\\s*$|CLASS\\b|OTHERWISE\\b)",
    "decreaseIndentPattern": "^\\s*(ENDIF|ELSE|ENDWHILE|UNTIL|NEXT|ENDPROCEDURE|ENDFUNCTION|ENDCASE|ENDTYPE|ENDCLASS|OTHERWISE)\\b"
  },
  "onEnterRules": []
}
```

Indent width should be 3 spaces to match the guide (§1.2). Ship that as a default in the extension's `configurationDefaults`:

```json
"configurationDefaults": {
  "[pseudocode]": { "editor.tabSize": 3, "editor.insertSpaces": true }
}
```

### 18.3 TextMate grammar

`syntaxes/pseudocode.tmLanguage.json`. Keep it small; correctness beats coverage. Patterns, in order:

| Pattern | Scope |
|---------|-------|
| `//.*$` | `comment.line.double-slash.pseudocode` |
| `"[^"]*"` | `string.quoted.double.pseudocode` |
| `'[^']'` | `string.quoted.single.pseudocode` |
| `\b\d{2}/\d{2}/\d{4}\b` | `constant.numeric.date.pseudocode` |
| `\b\d+\.\d+\b` | `constant.numeric.real.pseudocode` |
| `\b\d+\b` | `constant.numeric.integer.pseudocode` |
| `\b(TRUE\|FALSE)\b` | `constant.language.boolean.pseudocode` |
| `\b(INTEGER\|REAL\|CHAR\|STRING\|BOOLEAN\|DATE\|ARRAY)\b` | `storage.type.pseudocode` |
| `\b(IF\|THEN\|ELSE\|ENDIF\|CASE\|OF\|OTHERWISE\|ENDCASE\|FOR\|TO\|STEP\|NEXT\|WHILE\|ENDWHILE\|REPEAT\|UNTIL\|RETURN)\b` | `keyword.control.pseudocode` |
| `\b(DECLARE\|CONSTANT\|TYPE\|ENDTYPE\|DEFINE\|SET\|PROCEDURE\|ENDPROCEDURE\|FUNCTION\|ENDFUNCTION\|RETURNS\|CALL\|BYREF\|BYVAL\|CLASS\|ENDCLASS\|INHERITS\|PUBLIC\|PRIVATE\|NEW\|SUPER)\b` | `keyword.declaration.pseudocode` |
| `\b(INPUT\|OUTPUT\|OPENFILE\|READFILE\|WRITEFILE\|CLOSEFILE\|SEEK\|GETRECORD\|PUTRECORD\|READ\|WRITE\|APPEND\|RANDOM)\b` | `keyword.other.io.pseudocode` |
| `\b(RIGHT\|LENGTH\|MID\|LCASE\|UCASE\|INT\|RAND\|EOF)\b(?=\s*\()` | `support.function.builtin.pseudocode` |
| `\b(AND\|OR\|NOT\|DIV\|MOD)\b` | `keyword.operator.word.pseudocode` |
| `(←\|<-)` | `keyword.operator.assignment.pseudocode` |
| `(<>\|<=\|>=\|[<>=])` | `keyword.operator.comparison.pseudocode` |
| `[+\-*/&^]` | `keyword.operator.arithmetic.pseudocode` |
| `\b[A-Z][A-Za-z0-9_]*(?=\s*\()` | `entity.name.function.pseudocode` |

Order matters: comments and strings must come first, and the built-in-function pattern must precede the general keyword patterns so `INT(` colours as a function rather than nothing.

Because keywords are upper-case-only, use `\b(IF|...)\b` **without** the `i` flag. This gives a free visual signal: a lower-case `if` simply does not colour, which tells the student something is wrong before they run anything.

### 18.4 Snippets

`snippets/pseudocode.json`. At minimum:

| Prefix | Expands to |
|--------|-----------|
| `<-` | `←` (the ergonomic fix for [§3.1](#31-assignment-operator)) |
| `if` | `IF ${1:condition} THEN\n   $0\nENDIF` |
| `ifelse` | `IF ... THEN ... ELSE ... ENDIF` |
| `for` | `FOR ${1:i} ← ${2:1} TO ${3:10}\n   $0\nNEXT ${1:i}` |
| `while` | `WHILE ... ENDWHILE` |
| `repeat` | `REPEAT ... UNTIL ...` |
| `case` | `CASE OF ... OTHERWISE ... ENDCASE` |
| `proc` | `PROCEDURE ...() ... ENDPROCEDURE` |
| `func` | `FUNCTION ...() RETURNS ... ... ENDFUNCTION` |
| `type` | `TYPE ... ENDTYPE` |
| `class` | `CLASS ... ENDCLASS` |

The `for` snippet uses the same placeholder id `${1:i}` twice so typing the control variable fills in the `NEXT` automatically — a small thing that prevents `E2030` constantly.

### 18.5 The Run command

**[DECISION]** `pseudoLang.run` runs the program **in the extension host**, writing to a `vscode.Pseudoterminal`.

Two earlier designs were tried and rejected. The guide originally specified `vscode.debug.startDebugging(..., { noDebug: true })`, reusing the M10 adapter; that routes `INPUT` through a modal `showInputBox` per prompt, which is miserable for anything reading more than one value. M9 then shipped a real terminal running `node ${cliPath} run ${filePath}`, with `esbuild.mjs` bundling a second entry point `dist/pseudo-cli.js`. That gave `INPUT` a genuine keyboard — but it also meant a student had to install Node.js before the play button did anything at all, which is a real barrier for the people this is for.

A `Pseudoterminal` is a terminal VS Code lets the extension drive directly: the extension writes the bytes and receives the keystrokes, and no shell or subprocess is involved. It keeps everything the real terminal was chosen for and costs nothing to have. VS Code is already a JavaScript runtime; the interpreter can simply run in it.

Three consequences worth knowing before writing it:

- **The extension owns the line discipline.** A pty is raw. Nothing is echoed, `
` alone drops a line without returning the carriage, backspace must be painted as ` `, and escape sequences must be swallowed as a small state machine — an ESC arrives as `ESC [ D`, and dropping only the ESC leaves `[D` in the middle of the answer. Keep this in a class with no `vscode` import (`program-terminal.ts`) so it can be tested, the same way `session.ts` stays testable.
- **`beforeStatement` must yield to the event loop periodically.** Awaiting a hook only drains microtasks, so a program in a tight loop never reaches the phase where a keystroke is delivered. Without an occasional `setTimeout(0)`, Ctrl+C and the debugger's Pause button — the two things that exist precisely for an endless loop — are the two things an endless loop makes unreachable. Put the yield in the shared `Host`, so Run and Debug both get it.
- **Do not fire `onDidClose`.** It ends the pty, and VS Code takes an exited terminal away along with everything the program printed, which is the one thing the reader wanted to see. Print a dim `[Finished]` / `[Stopped]` / `[Failed]` line instead and leave the terminal standing. A pty runs one program and is then spent, so dispose the previous one when re-running.

Run and Debug now share one `ExtensionHost`; the debugger is the same thing with a `beforeStatement` that parks. The CLI still ships for anyone who wants pseudocode outside the editor, but nothing in the extension depends on it.

Save the file first if dirty. If the document is untitled, prompt to save — file-relative paths in `OPENFILE` need a real location.

### 18.6 Problem markers

`pseudoLang.check` runs the parser in-process and pushes results into a `vscode.DiagnosticCollection`. Wire it to run on save (`onDidSaveTextDocument`) for `.pseudo` documents. This gives most of the value of a language server for a fraction of the work, and is the natural upgrade path if you later add one.

---

## 19. The debug adapter

M10. Implemented **inline** — no separate process, no stdio protocol framing.

```ts
vscode.debug.registerDebugAdapterDescriptorFactory('pseudo', {
  createDebugAdapterDescriptor: () =>
    new vscode.DebugAdapterInlineImplementation(new PseudoDebugSession()),
});
```

`PseudoDebugSession extends DebugSession` from `@vscode/debugadapter`.

### 19.1 Why the async interpreter matters

The debug session owns a `DebugHost` whose `beforeStatement(node, stack)` implements the pause logic:

```ts
async beforeStatement(node: Stmt, stack: readonly Frame[]): Promise<void> {
  if (this.stopRequested) throw new HaltSignal();

  const shouldStop =
    this.breakpoints.has(node.span.line) ||
    (this.stepMode === 'in') ||
    (this.stepMode === 'over' && stack.length <= this.stepBaseDepth) ||
    (this.stepMode === 'out'  && stack.length <  this.stepBaseDepth);

  if (shouldStop) {
    this.currentLine = node.span.line;
    this.currentStack = stack;
    this.sendEvent(new StoppedEvent(reason, THREAD_ID));
    await this.resumePromise();          // parks here until continue/step
  }
}
```

`resumePromise()` returns a promise stored on the session; `continueRequest`, `nextRequest`, `stepInRequest` and `stepOutRequest` each set `stepMode` and resolve it. That is the whole stepping engine — about forty lines, and it only works because `execStmt` is `async`.

### 19.2 DAP requests to implement

| Request | Behaviour |
|---------|-----------|
| `initialize` | Report `supportsConfigurationDoneRequest: true`, `supportsSetVariable: true`, `supportsEvaluateForHovers: true` |
| `launch` | Read the program, lex, parse. On diagnostics, send `OutputEvent` with the rendered errors and `TerminatedEvent`. Otherwise start the interpreter (do not await it — let it run against the host) |
| `setBreakpoints` | Validate each line: a breakpoint is valid only on a line that starts a statement. Build the set of statement start lines from the AST once, at launch, and snap invalid breakpoints to the next valid line (`verified: true`, adjusted `line`) |
| `configurationDone` | Release the initial pause; honour `stopOnEntry` |
| `threads` | One thread, id 1, name "pseudocode" |
| `stackTrace` | Map the interpreter's `Frame[]` to DAP frames, innermost first. Frame name: the subprogram name, or `<main>` for the global frame |
| `scopes` | Two per frame: "Locals" and "Globals". Inside a method, a third: "Fields" |
| `variables` | Render `PValue`s. Arrays, records and objects are **expandable** — return a `variablesReference` and expand children lazily. Array children are named `[1]`, `[2]` or `[1,1]`, `[1,2]` |
| `setVariable` | Allow editing scalars in the panel; type-check the new value with the same `assignable` rules and reject with a message |
| `evaluate` | For `context: 'hover'` and `'watch'`, parse the expression with the same parser and evaluate it against the current frame. Guard against side effects: reject expressions containing a function call in hover context |
| `continue`, `next`, `stepIn`, `stepOut`, `pause` | Set `stepMode` and resolve the parked promise |
| `disconnect` / `terminate` | Set `stopRequested`; the next `beforeStatement` throws `HaltSignal` |

### 19.3 Input and output during debugging

`OUTPUT` becomes an `OutputEvent` on the debug console. `INPUT` is the interesting one — there is no terminal to read from.

**[DECISION]** `DebugHost.readLine()` sends a **custom DAP event** `pseudoInputRequest`; the extension listens via `onDidReceiveDebugSessionCustomEvent`, shows `vscode.window.showInputBox({ prompt: 'INPUT' })`, and replies with a `pseudoInputResponse` custom request carrying the line. Cancelling the box replies with `null`, which the interpreter sees as end of input.

The adapter never handles `noDebug`. Running without debugging is the Run command from [§18.5](#185-the-run-command), which drives a `Pseudoterminal` instead of a debug session. Both run the interpreter in the extension host against the same `ExtensionHost`; the only difference is that the debugger supplies a `beforeStatement` that parks and the Run command does not.

**Ordering.** `setBreakpoints` needs the statement lines, which only exist once `launchRequest` has parsed the program, and a client may send it before the launch response arrives. `launchRequest` resolves a `parseDone` promise as soon as the lines are known — including on the failure paths — and `setBreakPointsRequest` awaits it.

**Step out at the end of the program.** `stepOut` stops at the next statement shallower than the current frame. When the remaining work is all expression evaluation — a recursive `RETURN N * Factorial(N - 1)` unwinding, for instance — there is no such statement, and the program runs to completion. That is correct: there is genuinely nothing left to stop on.

### 19.4 Variable rendering

Match what a student expects to see:

| Value | Panel display |
|-------|---------------|
| `INTEGER 42` | `42` |
| `REAL 4.0` | `4.0` |
| `STRING "hi"` | `"hi"` |
| `CHAR 'x'` | `'x'` |
| `BOOLEAN` | `TRUE` / `FALSE` |
| `DATE` | `02/01/2005` |
| unset cell | `<no value>` |
| `ARRAY[1:30] OF STRING` | `ARRAY[1:30] OF STRING` + 30 expandable children |
| `RECORD StudentRecord` | `StudentRecord` + one child per field |
| `POINTER` | `^ → Counter` or `^ → <null>` |
| `OBJECT Cat` | `Cat` + one child per field, private ones marked |
| `SET` | `{'A','E','I','O','U'}` |

Show the declared type in the `type` field of each DAP variable so hovering shows it.

---

## 20. Test strategy

Vitest, run from the workspace root.

### 20.1 Unit tests

- **Lexer** — one test per token kind, plus the awkward cases: `<-` vs `<=` vs `<>` vs `<`, date vs division, `4.` rejected, unterminated string, lower-case keyword becomes an identifier.
- **Parser** — snapshot the AST for each grammar production. Snapshots are appropriate here; the AST shape is the thing being pinned.
- **Type rules** — a table-driven test over `assignable()` covering every pair in [§11.2](#112-types).
- **Operators** — a table of `(left, op, right) → result | error code`. Include `-7 DIV 2`, `-7 MOD 2`, `6 / 2 = 3.0`, `INTEGER + REAL = REAL`.

### 20.2 Conformance tests

The important suite. Directory per case:

```
tests/conformance/max-function/
  program.pseudo
  stdin.txt        (optional)
  expected.txt
  args.json        (optional: { "seed": 42, "strictDeclarations": true })
```

`tests/runner.ts` discovers every directory, runs the program through a `TestHost`, and compares captured output to `expected.txt` byte for byte. Add a case for every example in [Appendix A](#appendix-a--conformance-programs) before declaring the corresponding milestone done.

For file-handling cases, add `files/` (input fixtures, copied to a temp dir before the run) and `expected-files/` (compared after).

### 20.3 Error tests

```
tests/errors/E3082-array-out-of-bounds/
  program.pseudo
  expected.txt     (the full rendered diagnostic, including the caret line)
```

Pinning the rendered text is deliberate. The message quality *is* a feature of this project, so a change to the wording should be a visible diff, not a silent regression.

### 20.4 Extension tests

Minimal. Use `@vscode/test-electron` for two smoke tests: the extension activates on opening a `.pseudo` file, and a debug session launches and terminates. Do not try to unit-test the DAP protocol — test the interpreter through `core` and the adapter through these smoke tests.

### 20.5 CI

`.github/workflows/ci.yml` — on push and PR: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm test`, and `pnpm -C packages/vscode package` to prove the `.vsix` still builds. Run on `ubuntu-latest` and `windows-latest`; the path handling in `resolvePath` and the `\r\n` line splitting in the lexer are exactly the code that breaks across platforms.

---

## 21. Packaging and distribution

### 21.1 Bundling

The extension must ship as a single bundled file. `esbuild.mjs`:

```js
import { build } from 'esbuild';
await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  minify: process.env.NODE_ENV === 'production',
});
```

`external: ['vscode']` is required — that module is provided by the host. Everything else, including `@pseudo-lang/core` and `@vscode/debugadapter`, gets bundled in, which is what makes a workspace dependency work inside a `.vsix`.

Add `.vscodeignore` excluding `src/`, `node_modules/`, `*.map` in production, and the tests.

### 21.2 Building the `.vsix`

```bash
pnpm -C packages/vscode exec vsce package --no-dependencies
```

`--no-dependencies` is essential with pnpm: `vsce` would otherwise try to walk the symlinked `node_modules` tree and fail. Because esbuild has already bundled everything, no dependencies need to ship.

Install locally:

```bash
code --install-extension packages/vscode/pseudo-lang-0.1.0.vsix
```

### 21.3 GitHub repository

Repository `pseudo-lang`. Contents beyond the code:

- `README.md` — what it is, how to install the `.vsix`, a 20-line tour of the language, and a clear statement that this is an unofficial tool that follows the Cambridge 9618 pseudocode guide but is not endorsed by Cambridge.
- `CHANGELOG.md` — keep-a-changelog format.
- `LICENSE` — MIT for the code. **[DECISION]** The Cambridge guide is **not** redistributed: `*.pdf` and `guide.txt` are gitignored, and the README says where to download it instead. The guide is © Cambridge University Press & Assessment, it is freely available from them, and a repository that does not carry it cannot get the permissions wrong.
- `docs/DEVIATIONS.md` — extract every **[DECISION]** and **[DEVIATION]** from this guide into a user-facing page. Students and teachers need to know where the implementation had to choose.

### 21.4 Release workflow

`.github/workflows/release.yml`, triggered on tags matching `v*`:

```
build → test → vsce package → softprops/action-gh-release
  with the .vsix attached as a release asset
```

Users install by downloading the `.vsix` from the Releases page and running `code --install-extension`, or by dragging it into the Extensions view. Document both in the README.

Version the extension and the CLI together. Bump with `pnpm -r exec npm version <patch|minor|major>`.

---

## Appendix A — conformance programs

Every code example in the Cambridge guide, with its expected behaviour. Transcribe each into `tests/conformance/<name>/`. Programs are written here with `<-`; either form is accepted.

| Case | Guide § | Notes |
|------|---------|-------|
| `swap-procedure` | 1.5, 8.3 | Both change: `Y` inherits `BYREF` from `X` (see [§6, M5](#6-milestones)) |
| `variable-declarations` | 2.4 | three `DECLARE`s, no output; must not error |
| `constants` | 2.5 | `HourlyRate` and `DefaultText`; assigning to one → `E3004` |
| `assignments` | 2.6 | `Counter ← Counter + 1`, `TotalToPay ← NumberOfHours * HourlyRate` |
| `array-declarations` | 3.1 | `ARRAY[1:30] OF STRING`, `ARRAY[1:3,1:3] OF CHAR` |
| `array-elements` | 3.2 | `StudentNames[n+1] ← StudentNames[n]` |
| `whole-array-assign` | 3.2 | `SavedGame ← NoughtsAndCrosses` deep-copies |
| `array-init-loop` | 3.2 | `FOR Index ← 1 TO 30` filling with `""` |
| `enum-declaration` | 4.1 | `TYPE Season = (Spring, Summer, Autumn, Winter)` |
| `pointer-declaration` | 4.1 | `TYPE TIntPointer = ^INTEGER`, `DECLARE MyPointer : TIntPointer` |
| `record-declaration` | 4.1 | `TYPE StudentRecord ... ENDTYPE` |
| `set-declaration` | 4.1 | `TYPE LetterSet = SET OF CHAR`, `DEFINE Vowels ('A','E','I','O','U') : LetterSet` |
| `record-usage` | 4.2 | dot notation, `Pupil2 ← Pupil1`, `Form[Index].YearGroup` |
| `input-output` | 5.1 | `OUTPUT "You have ", Lives, " lives left"` |
| `string-functions` | 5.5 | `RIGHT("ABCDEFGH",3)="FGH"`, `LENGTH("Happy Days")=10`, `MID("ABCDEFGH",2,3)="BCD"`, `LCASE('W')='w'`, `UCASE('h')='H'` |
| `concatenation` | 5.5 | `"Summer" & " " & "Pudding"` |
| `numeric-functions` | 5.6 | `INT(27.5415)=27`; `RAND(87)` in `[0,87)` with a fixed seed |
| `nested-if` | 6.1 | the champion/highest-scorer example, all four branches |
| `case-statement` | 6.2 | the `W/S/A/D/OTHERWISE` move example |
| `case-range` | 6.2 | a `<value1> TO <value2>` clause |
| `nested-for` | 7.1 | the row-total / grand-total example |
| `for-step-negative` | 7.1 | `FOR Position ← 20 TO 10 STEP -1` |
| `repeat-until` | 7.2 | the password example, driven from `stdin.txt` |
| `while-loop` | 7.3 | `WHILE Number > 9` digital-root example |
| `procedures` | 8.1 | `DefaultSquare` / `Square(Size)` with stub `MoveForward`/`Turn` |
| `max-function` | 8.2 | `OUTPUT "Penalty Fine = ", Max(10, Distance*2)` |
| `text-file-copy` | 9.1 | `FileA.txt` → `FileB.txt` with dashes for blank lines |
| `random-file-insert` | 9.2 | the `StudentFile.Dat` shuffle |
| `class-pet-cat` | 10.2 | `Pet`, `Cat INHERITS Pet`, `SUPER.NEW`, `MyCat ← NEW Cat("Kitty","Shorthaired")` |
| `methods-properties` | 10.1 | `Player.SetAttempts(5)` then `OUTPUT Player.GetAttempts()` |

Where the guide's example is a fragment with undefined identifiers (most of them are), wrap it in the minimum surrounding code needed to run, and keep that wrapper obvious in the file.

---

## Appendix B — full keyword list

Taken from the guide's index of symbols and keywords, plus the keywords used in its body text. All are upper case and all are reserved — using any of them as an identifier is `E2002`/`E1014`-adjacent; give it a dedicated message: "`X` is a reserved keyword and cannot be used as an identifier".

```
AND        APPEND     ARRAY      BOOLEAN    BYREF      BYVAL
CALL       CASE       CHAR       CLASS      CLOSEFILE  CONSTANT
DATE       DECLARE    DEFINE     DIV        ELSE       ENDCASE
ENDCLASS   ENDFUNCTION           ENDIF      ENDPROCEDURE
ENDTYPE    ENDWHILE   EOF        FALSE      FOR        FUNCTION
GETRECORD  IF         INHERITS   INPUT      INT        INTEGER
LCASE      LENGTH     MID        MOD        NEW        NEXT
NOT        OF         OPENFILE   OR         OTHERWISE  OUTPUT
PRIVATE    PROCEDURE  PUBLIC     PUTRECORD  RAND       RANDOM
READ       READFILE   REAL       REPEAT     RETURN     RETURNS
RIGHT      SEEK       SET        STEP       STRING     SUPER
THEN       TO         TRUE       TYPE       UCASE      UNTIL
WHILE      WRITE      WRITEFILE
```

Symbols: `←` `<-` `+` `-` `*` `/` `&` `^` `=` `<>` `<` `<=` `>` `>=` `(` `)` `[` `]` `,` `:` `.` `//`

`EOF`, `INT`, `LCASE`, `LENGTH`, `MID`, `RAND`, `RIGHT`, `UCASE` are built-in **function names** rather than syntactic keywords. Reserve them anyway — redefining `LENGTH` as a variable would be legal in no reading of the guide, and reserving them lets the grammar stay simple.

---

## Where to start

1. Create the workspace and the three packages (M0).
2. Write `token.ts`, `keywords.ts`, `lexer.ts`, and the M1 acceptance test. Do not move on until `pseudo tokens` produces correct spans for a file containing every token kind.
3. Write `ast.ts` in full — all of it, from [§9](#9-ast-definitions) — before writing any of the parser. Having the complete node set up front stops the parser from growing ad-hoc shapes.
4. Build M2 end to end, including `Host`, `Cell`, `Scope` and the async interpreter. That milestone establishes every architectural decision in this document; the remaining milestones are mostly filling in cases.

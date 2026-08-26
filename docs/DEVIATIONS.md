# Where this implementation had to choose

The *Cambridge International AS & A Level Computer Science 9618 Pseudocode Guide for
Teachers* describes a notation for writing algorithms on paper. It is not a language
specification, and it does not try to be: it leaves a great deal unsaid, and in a few
places it contradicts itself.

Running pseudocode means answering those questions. Every answer this implementation
gives is listed below, with the reasoning. Nothing here changes how a program that
follows the guide behaves — these are the cases the guide does not cover.

If you are a teacher and you disagree with one of these, the reasoning is written down
so you can argue with it. Open an issue.

**Nothing in this document is examinable.** It describes one implementation of the
notation, not the notation itself.

---

## Contents

- [Writing programs](#writing-programs)
- [Types and values](#types-and-values)
- [Expressions](#expressions)
- [Variables and scope](#variables-and-scope)
- [Arrays, records and objects](#arrays-records-and-objects)
- [Subprograms](#subprograms)
- [Classes](#classes)
- [Files](#files)
- [The standard library](#the-standard-library)
- [Where the guide contradicts itself](#where-the-guide-contradicts-itself)
- [What is deliberately not supported](#what-is-deliberately-not-supported)

---

## Writing programs

### The assignment arrow may be typed as `<-`

The guide prints `←`, which is not on any keyboard. Both `←` and the two-character
`<-` are accepted and are indistinguishable once read.

`=` is **never** assignment. Writing `Total = 0` as a statement is `E2001`, and the
message spells out the correct form.

The VS Code extension rewrites a typed `<-` into `←` when the file is saved, so what
you keep looks like the guide's own listings. Turn that off with
`pseudoLang.insertArrowOnAssign` if you would rather it did not.

### Keywords are case-sensitive; identifiers are not

The guide states that keywords are upper case and identifiers are mixed case. This
implementation holds both halves to it:

- `if` is not `IF`. It is `E2010`, and the message says so. A lower-case keyword also
  fails to colour in the editor, which usually catches it before you run anything.
- `Counter` and `counter` are the **same variable**. Identifiers are matched
  case-insensitively, but the spelling from the declaration is what appears in error
  messages and in the debugger. Declaring two names that differ only in case in one
  scope is `E3003`.

### A long line may be wrapped

The guide prints `FUNCTION` headers wrapped across lines without any continuation
character. A line break is ignored when the line so far cannot possibly have ended —
after a comma, an open bracket, an assignment arrow, or a binary operator. Nothing else
continues a line.

### There are no escape sequences in a string

The guide defines none, so there are none. A `"` cannot appear inside a string, and a
string cannot span lines (`E1012`). `""` is a valid empty string.

### A date literal is `dd/mm/yyyy` with no spaces

`02/01/2005` is a date. `Total / 2 / 2005` is arithmetic. The two are told apart by the
absence of whitespace and by the exact two-two-four digit shape, which is unambiguous:
a real division whose parts happen to be zero-padded to that width is not something
anyone writes. An impossible calendar date such as `31/02/2005` is `E1010`.

---

## Types and values

### `DIV` and `MOD` on negative numbers

The guide does not say. `DIV` truncates toward zero and `MOD` takes the sign of the
dividend, which keeps the identity `a = (a DIV b) * b + (a MOD b)` true:

| Expression | Result |
| --- | --- |
| `7 DIV 2` | `3` |
| `-7 DIV 2` | `-3` |
| `7 MOD 2` | `1` |
| `-7 MOD 2` | `-1` |

Both require whole numbers. `7.5 DIV 2` is `E3010`, with a suggestion to use `INT`.

### `CHAR` and `STRING` are different types

They are kept apart everywhere except concatenation:

- `&` accepts a `CHAR` or a `STRING` on either side and always produces a `STRING`.
- Comparing a `CHAR` with a `STRING` using `=` is `E3013`.
- Storing a `CHAR` in a `STRING` variable is `E3012`.

This trips people up most often in `CASE OF`. A variable that is read with `INPUT` and
never declared holds a `STRING`, so `'W'` will never match it. Declare it
`: CHAR` first. `E3040` says this in as many words.

### `REAL` values always print with a decimal point

`4.0` prints as `4.0`, never as `4`. The guide is explicit that a `REAL` is written with
at least one digit after the point.

An `INTEGER` may be stored in a `REAL` — it widens. A `REAL` may not be stored in an
`INTEGER`; use `INT`.

---

## Expressions

### `&` binds like `+`

The guide gives no precedence for concatenation. It sits with `+` and `-`, which is the
conventional choice and makes `"a" & "b" = "ab"` parse the way it reads.

### Comparisons cannot be chained

`0 < Age < 20` is `E2060`, not a silent `(0 < Age) < 20`. The message tells you to write
`(0 < Age) AND (Age < 20)`.

### `NOT` binds tighter than `AND` but looser than a comparison

So `NOT X = Y` reads as `NOT (X = Y)`, which is what anyone writing it means.

---

## Variables and scope

### Declaring is good practice, not compulsory

The guide calls `DECLARE` good practice. By default an undeclared variable comes into
existence on first assignment and takes the type of the value assigned to it. Reading a
name that was never assigned is `E3001`.

Turn on `pseudoLang.strictDeclarations` (or pass `--strict-declarations`) to require
`DECLARE`, which is closer to exam discipline. Under that setting the same mistake
becomes `E3002`, "is not declared", which points at the real problem.

### A variable is not zero

`DECLARE Total : INTEGER` does not make `Total` zero. Reading it before assigning is
`E3001`. The guide promises no default value, and catching the omission is more useful
than hiding it. Arrays, records and pointers *are* built by `DECLARE`, because there is
nothing else that could build them — but their elements and fields start with no value
in the same way.

### Scope

The guide does not describe scope at all. The rules here are the smallest set that make
its own examples work:

- A subprogram body sees its parameters, its own locals, and the globals. It does not
  see the locals of whatever called it.
- A method body also sees the fields of the object it was called on, unqualified, which
  is how the guide's own class examples are written.
- A `FOR` loop's counter lives in the scope that contains the loop, and keeps its final
  value after `NEXT`.

### A `FOR` loop evaluates its bounds once

`FOR Index <- 1 TO Count` reads `Count` once, before the first pass. Changing `Count`
inside the loop does not change how many passes there are. The guide gives the
behaviour but not the evaluation order.

`STEP 0` is `E3031` rather than an infinite loop.

---

## Arrays, records and objects

### Assigning a whole array or record copies it

`SavedGame <- NoughtsAndCrosses` is a **deep copy**. Changing one afterwards does not
touch the other. Arrays must match in element type and in every bound (`E3080`);
records must be of the same declared type (`E3081`).

### An object is a reference

`Cat2 <- Cat1` makes both names refer to the **same** cat. This is the one place where
assignment does not copy, and it matches how objects behave in every language the guide's
readers will go on to use. Pointers are the other reference type, which is their purpose.

### Only one- and two-dimensional arrays

The guide shows no more. A third dimension is a syntax error rather than a silent
success, because a program that uses one would not be answering a 9618 question.

Bounds are checked on every read and write, and `E3082` names the declared range.

---

## Subprograms

### `BYVAL` and `BYREF` are sticky

Guide §8.3: "If there are several parameters passed by the same method, the `BYVAL` or
`BYREF` keyword need not be repeated."

So in the guide's own example —

```
PROCEDURE SWAP(BYREF X : INTEGER, Y : INTEGER)
```

— **both** `X` and `Y` are passed by reference, and `CALL SWAP(A, B)` really does swap
`A` and `B`. This is the only reading under which the example does what its name says.

The mode starts as `BYVAL` and changes only where a `BYVAL` or `BYREF` keyword appears.
Write `BYVAL` explicitly to change back.

### Subprograms are hoisted

A procedure may call one that is defined further down the file. The guide's
`DefaultSquare`/`Square` example depends on this.

### Recursion has a depth limit

2000 nested calls by default, then `E3020`. Runaway recursion should produce a
diagnostic that names the subprogram, not a stack overflow. Change it with
`pseudoLang.maxCallDepth` or `--max-depth`.

### A function cannot take a `BYREF` parameter

The guide says parameters should not be passed by reference to a function. That is
enforced: `E2081`.

---

## Classes

### A subclass method overrides its parent's

The guide does not discuss overriding, but `SUPER.NEW` only means anything if a subclass
can replace a parent's method. Dispatch is on the object's **actual** class, so a
`Square` held in a `Shape` variable still uses `Square`'s methods.

### A method may call another method of the same object

The guide always writes `Object.Method(...)`, and 9618 has no `THIS` or `SELF` keyword.
Taken literally that leaves no way at all for one method to call another on the same
object — a thing any student would write, with no correct form to be pointed at.

Since the guide already resolves *fields* unqualified inside a method
(`Attempts ← Number`), methods do the same. An unqualified name inside a method body
finds a method of the current object first, and only then a global subprogram of the
same name.

`CALL Object.Method(...)` is still a syntax error: the guide shows the qualified form
without `CALL`, so that is the only spelling accepted.

### `PRIVATE` reaches a subclass

A `PRIVATE` member is usable from inside the class that declared it **and** from a class
that inherits from it. The guide does not say which it means; the more permissive rule
is the one that keeps its inheritance example working.

---

## Files

### A file left open is saved, not lost

Any file still open when the program ends is flushed and closed, and `W1001` warns about
it, pointing at the `OPENFILE`. Losing a student's output to a forgotten `CLOSEFILE`
teaches nothing useful.

### Random files have an invented on-disk format

The guide describes random files as fixed-length records with a movable pointer and
defines no format at all. This one is ours:

- Slot *n* (1-based, matching `SEEK`) occupies bytes `[(n-1) × size, n × size)`.
- Each slot holds a UTF-8 JSON encoding of the record, right-padded with spaces.
- An all-space slot is empty.
- The default slot size is 512 bytes (`pseudoLang.randomFileRecordSize`).

It is deliberately readable in a text editor. It is not compatible with any other tool,
because there is no interchange format to be compatible with.

### Text files are read a line at a time

`READFILE` reads one line, and `EOF` reports whether another line remains. Reading past
the end is `E3115` rather than an empty string, with a reminder to test `EOF` first.

---

## The standard library

Exactly eight functions exist, and they are the eight the guide defines:

`RIGHT`, `LENGTH`, `MID`, `LCASE`, `UCASE`, `INT`, `RAND`, `EOF`

Calling anything else is `E3090`, and the message lists all eight. There is no opt-in
extension set. A student who can call `LEFT` here but not in the exam has been taught
the wrong thing, and an exam question that supplies an extra function supplies it as
pseudocode — which this already runs.

`RAND(x)` returns a `REAL` in `[0, x)`. Pass `--seed` to the CLI to make a run
reproducible.

---

## Where the guide contradicts itself

Two places, both handled by following the guide's prose over its example code.

### §10.1 calls a `PRIVATE` function from outside its class

The guide declares `PRIVATE FUNCTION GetAttempts()` and then, four lines later, writes
`OUTPUT Player.GetAttempts()`. Both cannot be right.

The prose rule wins: "Methods and properties can be assumed to be public unless
otherwise stated." That example's `PRIVATE` is treated as a slip for `PUBLIC`, and
access control is enforced as the prose describes. Reaching a genuinely `PRIVATE` member
from outside is `E3100`.

### §4.2's pointer example does not type-check

The guide declares `MyPointer : TIntPointer` where `TIntPointer = ^INTEGER`, then assigns
it the address of a variable that is never declared. The **declaration forms** are what
this implementation follows; the example itself cannot run in any reading, so the
conformance case for it uses the same forms around a variable that exists.

---

## What is deliberately not supported

None of these appear in the guide, and adding them would let a program run here that
would not be accepted in an exam.

- `ELSE IF` as one keyword. Nest a second `IF` inside the `ELSE`, as the guide does.
- `+=`, `-=` and the other compound assignments.
- `AND`/`OR` used on anything but `BOOLEAN` values.
- Arrays of more than two dimensions.
- Any function outside the eight above.
- `RETURN` inside a procedure (`E2080`) — use a `BYREF` parameter.
- Calling a function with `CALL` (`E2082`), or a procedure without it (`E2083`).

There is also no static type-checking pass. Types are checked as the program runs, which
means a type error in a branch that never executes is never reported. This matches how a
student traces a program by hand.

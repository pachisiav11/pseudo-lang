# Pseudocode (Cambridge 9618)

Write, run and debug the pseudocode defined in the *Cambridge International AS & A Level
Computer Science 9618 Pseudocode Guide for teachers (for examination from 2027)*.

IGCSE 0478 pseudocode is a subset of 9618, so IGCSE programs run here unchanged.

## Features

- Syntax highlighting for `.pseudo` files
- **Run File** — runs the open program in a terminal, so `INPUT` reads from the keyboard
- **Check File** — reports syntax problems in the Problems panel, automatically on save
- 20 snippets covering every block construct in the guide
- `<-` is rewritten to `←` when the file is saved, so you never have to reach for the character
- Three-space indentation is preset for `.pseudo` files, matching the guide's own listings

## Getting started

Create a file called `hello.pseudo`:

```
DECLARE Name : STRING

OUTPUT "What is your name? "
INPUT Name
OUTPUT "Hello, ", Name
```

Press the ▷ button in the editor title bar, or run **Pseudocode: Run File** from the
Command Palette.

## Commands

| Command | Default key | What it does |
| --- | --- | --- |
| `Pseudocode: Run File` | ▷ in the title bar | Runs the open file in the Pseudocode terminal |
| `Pseudocode: Check File` | — | Parses the file and fills the Problems panel |
| `Pseudocode: Insert Assignment Arrow` | `Alt` `-` | Inserts `←` at the cursor |

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `pseudoLang.strictDeclarations` | `false` | Require `DECLARE` before a variable is used. The guide calls declaring good practice rather than compulsory; turn this on for exam discipline. |
| `pseudoLang.insertArrowOnAssign` | `true` | Rewrite a typed `<-` into `←` on save. |
| `pseudoLang.checkOnSave` | `true` | Report syntax problems when the file is saved. |
| `pseudoLang.maxCallDepth` | `2000` | How deeply a subprogram may call itself before the run stops. |
| `pseudoLang.randomFileRecordSize` | `512` | Slot size in bytes for random-access files. |

## Requirements

Node.js 20 or later must be on your `PATH`. The **Run File** command uses it to execute
the bundled interpreter.

## What is supported

Everything the 9618 guide defines: the six primitive types and `DATE`, one- and
two-dimensional arrays, all five control structures, procedures and functions with
`BYVAL`/`BYREF`, records, enumerated types, pointers, sets, text and random file
handling, and classes with inheritance and access modifiers.

The interpreter is deliberately strict. It accepts only the forms the guide prints, and
rejects near-misses with a message naming the correct form — `=` used as assignment, for
example, is reported as `E2001` with the arrow form spelled out.

Where the guide is silent or self-contradictory, the choice made here is recorded in
[`docs/DEVIATIONS.md`](https://github.com/pachisiav11/pseudo-lang/blob/main/docs/DEVIATIONS.md).

## Licence

MIT. The pseudocode language definition is Cambridge Assessment International Education's;
this extension is an independent implementation of it and is not endorsed by Cambridge.

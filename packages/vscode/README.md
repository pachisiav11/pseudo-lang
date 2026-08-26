# Pseudocode (Cambridge 9618)

Write, run and debug the pseudocode defined in the *Cambridge International AS & A Level
Computer Science 9618 Pseudocode Guide for teachers (for examination from 2027)*.

IGCSE 0478 pseudocode is a subset of 9618, so IGCSE programs run here unchanged.

## Features

- Syntax highlighting for `.pseudo` files
- **Run File** — runs the open program in a terminal, so `INPUT` reads from the keyboard
- **A step debugger** — breakpoints, step over/into/out, the call stack, and a variables
  panel that expands arrays, records and objects
- **Check File** — reports syntax problems in the Problems panel, automatically on save
- 20 snippets covering every block construct in the guide
- `<-` is rewritten to `←` when the file is saved, so you never have to reach for the character
- Three-space indentation is preset for `.pseudo` files, matching the guide's own listings

## Getting started

**You need [Node.js 20 or later](https://nodejs.org/) on your machine** for the
Run button. The debugger runs inside VS Code and does not need it.

Create a file called `hello.pseudo`:

```
DECLARE Name : STRING

OUTPUT "What is your name? "
INPUT Name
OUTPUT "Hello, ", Name
```

Press the ▷ button in the editor title bar, or run **Pseudocode: Run File** from the
Command Palette.

## Debugging

Click in the gutter to set a breakpoint, then press `F5`. No `launch.json` is needed —
the open `.pseudo` file is debugged.

- The **variables** panel shows every value the way the guide prints it: `4.0` for a
  REAL, `TRUE`/`FALSE` for a BOOLEAN, `02/01/2005` for a DATE, and `<no value>` for a
  variable that has been declared but never assigned. Arrays, records, objects, sets and
  pointers expand; array elements are named by their declared index, so an
  `ARRAY[1:30]` starts at `[1]` and a two-dimensional one reads `[1,1]`, `[1,2]`.
- The **call stack** shows one frame per active call, with `<main>` at the bottom.
- **Watch** and hover evaluate an expression against the selected frame. A hover will
  not run a call, so looking at a value can never change one.
- Editing a value in the panel is type-checked the same way an assignment is.
- `INPUT` asks for the line in an input box, since a debug session has no terminal.

A breakpoint on a blank line or on `ENDIF` moves down to the next real statement.

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

## If something goes wrong

| What you see | What to do |
| --- | --- |
| `node: command not found` in the terminal | Node.js is not installed, or VS Code was open when you installed it. Install [Node.js](https://nodejs.org/), then close and reopen VS Code. |
| No colours in the file | Check it really ends in `.pseudo`. Keywords only colour in **UPPER CASE** — a lower-case `if` staying grey means the keyword is wrong. |
| The ▷ button is missing | The file is not recognised as pseudocode. Save it with a `.pseudo` ending. |

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

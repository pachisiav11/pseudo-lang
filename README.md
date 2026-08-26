# pseudo-lang

An interpreter and VS Code extension for the pseudocode defined in the
**Cambridge International AS & A Level Computer Science 9618** pseudocode guide
(for exams in 2027, 2028 and 2029).

Write pseudocode exactly as the guide specifies, then run it.

```
DECLARE Total : INTEGER
Total <- 0

FOR Index <- 1 TO 10
   Total <- Total + Index
NEXT Index

OUTPUT "The total is ", Total
```

Because 9618 pseudocode is a superset of the pseudocode used at IGCSE, programs
written for Cambridge IGCSE Computer Science 0478 also run unchanged.

## Install

> **New to this?** Follow the step-by-step guide at
> **[pachisiav11.github.io/pseudo-lang](https://pachisiav11.github.io/pseudo-lang/)** —
> it walks through every menu and covers what to do when things go wrong. The
> short version follows.

You need **[Visual Studio Code](https://code.visualstudio.com/)** and nothing
else. No runtime to install, no command line, no account.

The extension is not on the Marketplace, so you download one file and add it to
VS Code by hand. It takes about a minute.

### Step 1 — download the extension

Go to the **[latest release](https://github.com/pachisiav11/pseudo-lang/releases/latest)**
and download **`pseudo-lang-0.2.0.vsix`** from the Assets list at the bottom.

Save it anywhere you like. Your Downloads folder is fine.

### Step 2 — add it to VS Code

Open VS Code, then:

1. Press **`Ctrl` `Shift` `X`** (on a Mac, **`Cmd` `Shift` `X`**) to open the
   Extensions view.
2. Click the **`...`** button at the top of that panel.
3. Choose **Install from VSIX...**
4. Select the `.vsix` file you just downloaded.

VS Code will say the extension was installed.

<details>
<summary>Or install it from a terminal instead</summary>

```bash
code --install-extension pseudo-lang-0.2.0.vsix
```

Run this from the folder you saved the file in. On a Mac, if `code` is not
recognised, open VS Code, press `Cmd` `Shift` `P`, and run
**Shell Command: Install 'code' command in PATH** first.

</details>

### Step 3 — check it worked

Make a new file called **`hello.pseudo`** and type this in:

```
DECLARE Name : STRING

OUTPUT "What is your name? "
INPUT Name
OUTPUT "Hello, ", Name
```

The keywords should turn colour as you type. Then press the **▷ button** at the
top right of the editor. A terminal opens, asks your name, and greets you.

That is everything. You are set up.

### Using it day to day

| To do this | Press this |
| --- | --- |
| Run the open file | the **▷** button, top right |
| Debug it — breakpoints, stepping, variables | **`F5`** |
| Stop a program that will not end | **`Ctrl` `C`** in the terminal |
| Type the `←` arrow | **`Alt` `-`**, or just type `<-` and save |
| See mistakes before running | save the file, then look at the Problems panel |

You never have to type `←`. Type `<-` and it becomes `←` when you save.

### If something goes wrong

| What you see | What to do |
| --- | --- |
| No colours in a `.pseudo` file | Check the file really ends in `.pseudo`. Keywords only colour in **UPPER CASE** — a lower-case `if` staying grey means the keyword is wrong. |
| The **▷** button is missing | The file is not recognised as pseudocode. Save it with a `.pseudo` ending. |
| A program that never stops | Click inside the terminal and press `Ctrl` `C`. |

## Use it from the command line

Optional, and separate from the extension. This is the one part that wants
Node.js, because it is a command-line program; the editor does not.

```bash
git clone https://github.com/pachisiav11/pseudo-lang.git
cd pseudo-lang
pnpm install && pnpm build
node packages/cli/dist/main.js run examples/grades.pseudo
```

| Command | What it does |
| --- | --- |
| `pseudo run <file>` | Runs the program |
| `pseudo check <file>` | Reports problems without running |
| `pseudo tokens <file>` | Dumps the token stream |
| `pseudo ast <file>` | Dumps the syntax tree |

Useful options: `--strict-declarations`, `--seed <n>` for a repeatable `RAND`,
and `--max-depth <n>`.

## Examples

[`examples/`](examples) holds short programs covering the main features:
[`hello.pseudo`](examples/hello.pseudo) for `INPUT`/`OUTPUT`,
[`grades.pseudo`](examples/grades.pseudo) for arrays and functions,
[`records.pseudo`](examples/records.pseudo) for records and `BYREF`, and
[`shapes.pseudo`](examples/shapes.pseudo) for classes and inheritance.

## What is supported

Everything the guide defines: the six primitive types and `DATE`, one- and
two-dimensional arrays, all five control structures, procedures and functions
with `BYVAL`/`BYREF`, records, enumerated types, pointers, sets, text and
random file handling, and classes with inheritance and access modifiers.

The interpreter is deliberately strict. It accepts only the forms the guide
prints, and rejects near-misses with a message naming the correct form:

```
error[E2001]: `=` cannot be used to assign a value
 --> volume.pseudo:2:7
  |
2 | Total = 0
  |       ^ this is a comparison operator
  |
help: Assignment in 9618 pseudocode is written with a left arrow:
      Total <- 0
```

## Where the guide leaves gaps

A pseudocode guide for teachers is not a language specification, and running
pseudocode means answering questions it never asked. Every choice this
implementation makes is written down, with the reasoning, in
[docs/DEVIATIONS.md](docs/DEVIATIONS.md) — including the two places where the
guide contradicts itself.

None of it is examinable. It describes one implementation of the notation, not
the notation.

## The Cambridge guide itself

This repository does not carry the PDF. It is © Cambridge University Press &
Assessment and is available free from
[cambridgeinternational.org](https://www.cambridgeinternational.org/) — look
for *9618 Pseudocode Guide for Teachers (for examination from 2027)*.

## Status

All eleven milestones are complete, and the Run button no longer needs Node.js. See [BUILD_GUIDE.md](BUILD_GUIDE.md) for the
full specification, and [CHANGELOG.md](CHANGELOG.md) for what landed when.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

`pnpm package` builds the `.vsix` into `packages/vscode/`, if you would rather
build it than download it.

The suite has 339 tests. `tests/conformance/` holds one directory per example in
the Cambridge guide, each with its program and its expected output;
`tests/errors/` pins the full rendered text of a diagnostic, caret line and all,
so a change to the wording is a visible diff rather than a silent regression.

Press `F5` in this repository to launch an Extension Development Host with the
extension loaded and the `examples/` folder open.

## Licence

MIT for the code. This is an unofficial tool. It follows the Cambridge 9618
pseudocode guide but is not endorsed by or affiliated with Cambridge University
Press & Assessment.

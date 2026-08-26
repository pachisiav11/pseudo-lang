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

## Install the VS Code extension

There is no Marketplace listing. Build the `.vsix` yourself, or download it from
the [releases page](https://github.com/pachisiav11/pseudo-lang/releases).

```bash
pnpm install
pnpm package
```

That writes `packages/vscode/pseudo-lang-<version>.vsix`. Install it with:

```bash
code --install-extension packages/vscode/pseudo-lang-0.1.0.vsix
```

Open any `.pseudo` file and press the ▷ button in the editor title bar to run it, or
`F5` to debug it with breakpoints, stepping and a variables panel.

## Use it from the command line

```bash
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

All eleven milestones are complete. See [BUILD_GUIDE.md](BUILD_GUIDE.md) for the
full specification, and [CHANGELOG.md](CHANGELOG.md) for what landed when.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

The suite has 324 tests. `tests/conformance/` holds one directory per example in
the Cambridge guide, each with its program and its expected output;
`tests/errors/` pins the full rendered text of a diagnostic, caret line and all,
so a change to the wording is a visible diff rather than a silent regression.

Press `F5` in this repository to launch an Extension Development Host with the
extension loaded and the `examples/` folder open.

## Licence

MIT for the code. This is an unofficial tool. It follows the Cambridge 9618
pseudocode guide but is not endorsed by or affiliated with Cambridge University
Press & Assessment.

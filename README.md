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

Open any `.pseudo` file and press the ▷ button in the editor title bar.

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

## Status

Milestones M0–M9 are complete: the language runs in full, and the VS Code
extension ships syntax highlighting, snippets, problem markers and a Run
command. The step debugger (M10) is next.

See [BUILD_GUIDE.md](BUILD_GUIDE.md) for the full specification and the
milestone plan, and [todo.md](todo.md) for progress.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

Press `F5` in this repository to launch an Extension Development Host with the
extension loaded and the `examples/` folder open.

## Licence

MIT for the code. This is an unofficial tool. It follows the Cambridge 9618
pseudocode guide but is not endorsed by or affiliated with Cambridge University
Press & Assessment.

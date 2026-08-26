# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-26

### Changed

- The **▷** Run button no longer needs Node.js. The interpreter runs inside the
  extension host and writes to a VS Code `Pseudoterminal`, rather than spawning
  the bundled CLI as a subprocess. Installing the extension is now the only step
  — nothing else to download, and no command line to touch.
- Run and Debug share one `ExtensionHost`. The debugger is the same host with a
  `beforeStatement` hook that parks; running a file leaves the hook out.
- The extension no longer bundles `dist/pseudo-cli.js`. The CLI still ships as
  its own package for use outside the editor.

### Fixed

- A program in a tight loop starved the event loop, so keystrokes were never
  delivered — which made Ctrl+C and the debugger's **Pause** button unreachable
  in exactly the situation they exist for. The host now hands the event loop
  back periodically.
- Arrow keys typed at an `INPUT` prompt left `[D` and friends in the answer.
  Escape sequences are consumed whole.

## [0.1.0] - 2026-08-26

### Added

- M0: pnpm workspace skeleton with `core`, `cli` and `vscode` packages, shared
  TypeScript configuration, Vitest setup and cross-platform CI.
- M1: lexer covering every token in the guide — the `←`/`<-` assignment pair,
  padded `dd/mm/yyyy` date literals, case-sensitive keywords, comments and
  implicit line continuation. Diagnostic catalogue and the rendered error
  format. `pseudo tokens` dumps the stream.
- M2: the complete AST, a recursive-descent parser with precedence climbing,
  the tagged-value runtime, storage cells, scopes, and an async tree-walking
  interpreter. Covers DECLARE, CONSTANT, assignment, INPUT and OUTPUT. `pseudo
  run`, `pseudo check` and `pseudo ast` work.
- M3: control flow. IF/ELSE, CASE OF with ranges and OTHERWISE, count-controlled
  FOR with STEP, REPEAT/UNTIL and WHILE. An unclosed block is reported against
  the line that opened it.
- M4: one- and two-dimensional arrays. Bounds are checked on every read and
  write, and the message names the declared range. Whole-array assignment
  deep-copies and requires matching bounds and element type.
- M5: subprograms and the standard library. PROCEDURE, FUNCTION, CALL, RETURN,
  BYVAL/BYREF with the guide's sticky-mode rule, recursion with a depth limit,
  and the eight functions the guide defines. Subprograms are hoisted, so one
  may call another defined further down the file.
- M6: user-defined types. Records with dot notation and by-value copying,
  enumerated types that compare by declaration order, pointer types with `^`
  for address-of and dereference, and set types with DEFINE. Case labels may
  now be a CONSTANT or an enumerated value as well as a literal.
- M7: file handling. Text files in READ, WRITE and APPEND modes with EOF, and
  random files with SEEK, GETRECORD and PUTRECORD. A file left open at the end
  of the program is flushed and warned about rather than silently lost.
- M8: object-oriented programming. CLASS with PUBLIC/PRIVATE members, NEW
  constructors, INHERITS, SUPER, dynamic dispatch on the object's actual class,
  and access control that a subclass can pass through.
- M9: the VS Code extension. Syntax highlighting, twenty snippets, problem
  markers on save, and a Run command that executes the file in a terminal so
  INPUT reads from the keyboard. A typed `<-` is rewritten to `←` on save, and
  `.pseudo` files default to three-space indentation to match the guide's own
  listings. `pnpm package` produces the `.vsix`.
- M10: the step debugger. An inline debug adapter with breakpoints, step
  over/into/out, the call stack, and a variables panel that expands arrays,
  records, objects, sets and pointers and marks PRIVATE fields. Watch and hover
  evaluate an expression against the selected frame, and a hover never runs a
  call. Values may be edited in the panel, type-checked the same way an
  assignment is. INPUT is asked for in an input box, since a debug session has
  no terminal. A breakpoint on a blank line moves to the next statement.

- M11: release. docs/DEVIATIONS.md records every decision the guide left open
  and the two places where it contradicts itself. A conformance suite with one
  directory per example in the guide, and an error suite that pins the full
  rendered text of each diagnostic. A release workflow that attaches the .vsix
  to a tagged GitHub release, and a CI step that proves the .vsix still builds.

### Fixed

- A FOR loop written with the `←` character was rejected with "expected `<-`".
  The parser matched the token's text as well as its kind, and ASSIGN carries
  whichever of the two forms was typed. Only keywords are matched by text now.
- A method could not call another method of the same object. The guide gives no
  THIS keyword, so an unqualified name inside a method body now resolves to a
  method of the current object before it resolves to a global subprogram.
- `W1001` pointed at line 1 rather than at the `OPENFILE` that was left open.
- Reading an undeclared name under `--strict-declarations` reported `E3001`
  ("used before it is given a value"), which named the wrong mistake. It is
  `E3002` ("is not declared") now.
- `Go()` written without `CALL` reported `E2002`, "expected `<-`". It is `E2083`
  now, and the help spells out the correct line.
- A three-dimensional array reported `E2084`, "expected a type". It has its own
  code, `E2085`, and a message that says one or two dimensions.
- Whole-array and whole-record assignment mismatches fell into the generic
  `E3012`. They raise `E3080` and `E3081`, which say what actually differs.
- Runaway recursion printed a two-thousand-line call stack. The rendered stack
  stops after ten frames and says how many more there were.

### Removed

- `RunOptions.extraBuiltins`, which was never read. Only the eight functions the
  guide defines exist, and that is deliberate.

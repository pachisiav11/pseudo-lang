# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

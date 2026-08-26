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

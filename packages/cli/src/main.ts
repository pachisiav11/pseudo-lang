#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DiagnosticSink,
  SourceFile,
  VERSION,
  lex,
  parseSource,
  renderAll,
  renderDiagnostic,
  runSource,
} from '@pseudo-lang/core';
import { NodeHost } from './node-host';

const USAGE = `pseudo ${VERSION}

usage:
  pseudo run <file.pseudo>      run a program
  pseudo check <file.pseudo>    report diagnostics without running
  pseudo tokens <file.pseudo>   dump the token stream
  pseudo ast <file.pseudo>      dump the syntax tree as JSON
  pseudo --version

options:
  --strict-declarations   require DECLARE before a variable is used
  --seed <n>              make RAND deterministic
  --max-depth <n>         limit recursion depth (default 2000)
`;

export interface Options {
  strictDeclarations: boolean;
  seed: number | undefined;
  maxDepth: number;
}

export function parseOptions(argv: string[]): { rest: string[]; options: Options } {
  const rest: string[] = [];
  const options: Options = { strictDeclarations: false, seed: undefined, maxDepth: 2000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--strict-declarations') options.strictDeclarations = true;
    else if (arg === '--seed') {
      i += 1;
      options.seed = Number(argv[i]);
    } else if (arg === '--max-depth') {
      i += 1;
      options.maxDepth = Number(argv[i]);
    } else rest.push(arg);
  }
  return { rest, options };
}

function load(path: string): SourceFile {
  const full = resolve(path);
  return new SourceFile(path, readFileSync(full, 'utf8'));
}

async function main(argv: string[]): Promise<number> {
  const { rest, options } = parseOptions(argv);

  if (rest.includes('--version') || rest.includes('-v')) {
    process.stdout.write(`pseudo ${VERSION}\n`);
    return 0;
  }

  const command = rest[0];
  const file = rest[1];

  if (command === undefined || file === undefined) {
    process.stdout.write(USAGE);
    return command === undefined ? 0 : 1;
  }

  let source: SourceFile;
  try {
    source = load(file);
  } catch {
    process.stderr.write(`pseudo: cannot read ${file}\n`);
    return 1;
  }

  switch (command) {
    case 'tokens': {
      const sink = new DiagnosticSink();
      const { tokens } = lex(source, sink);
      for (const tok of tokens) {
        const value = tok.value === undefined ? '' : ` = ${JSON.stringify(tok.value)}`;
        process.stdout.write(
          `${String(tok.span.line).padStart(4)}:${String(tok.span.col).padStart(3)}  ` +
            `${tok.kind.padEnd(11)} ${JSON.stringify(tok.text)}${value}\n`,
        );
      }
      if (sink.hasErrors) {
        process.stderr.write(`\n${renderAll(sink.errors, source)}\n`);
        return 1;
      }
      return 0;
    }

    case 'check': {
      const parsed = parseSource(source);
      if (parsed.warnings.length > 0) {
        process.stderr.write(`${renderAll(parsed.warnings, source)}\n`);
      }
      if (parsed.errors.length > 0) {
        process.stderr.write(`${renderAll(parsed.errors, source)}\n`);
        return 1;
      }
      process.stdout.write('no problems found\n');
      return 0;
    }

    case 'ast': {
      const parsed = parseSource(source);
      if (parsed.program === null) {
        process.stderr.write(`${renderAll(parsed.errors, source)}\n`);
        return 1;
      }
      process.stdout.write(`${JSON.stringify(parsed.program, null, 2)}\n`);
      return 0;
    }

    case 'run': {
      const host = new NodeHost(file, options.seed);
      try {
        const result = await runSource(source, host, {
          strictDeclarations: options.strictDeclarations,
          maxCallDepth: options.maxDepth,
        });
        for (const warning of result.warnings) {
          process.stderr.write(`${renderDiagnostic(warning, source)}\n`);
        }
        if (!result.ok) {
          process.stderr.write(`${renderAll(result.errors, source)}\n`);
          return 1;
        }
        return 0;
      } finally {
        host.dispose();
      }
    }

    default:
      process.stderr.write(`pseudo: unknown command \`${command}\`\n\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`pseudo: internal error\n${String(err)}\n`);
    process.exitCode = 2;
  },
);

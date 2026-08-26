#!/usr/bin/env node
import { VERSION } from '@pseudo-lang/core';

function main(argv: string[]): number {
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`pseudo ${VERSION}\n`);
    return 0;
  }
  process.stdout.write('usage: pseudo <run|check|tokens|ast> <file.pseudo>\n');
  return 0;
}

process.exitCode = main(process.argv.slice(2));

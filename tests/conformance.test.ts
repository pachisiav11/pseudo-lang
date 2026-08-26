import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceFile, TestHost, renderAll, runSource } from '@pseudo-lang/core';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)));

interface CaseArgs {
  seed?: number;
  strictDeclarations?: boolean;
  maxCallDepth?: number;
  randomFileRecordSize?: number;
}

function casesIn(folder: string): string[] {
  const path = join(root, folder);
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function read(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

/** Text fixtures the program will open, keyed by the name it opens them with. */
function inputFiles(caseDir: string): Map<string, string> {
  const folder = join(caseDir, 'files');
  const files = new Map<string, string>();
  if (!existsSync(folder)) return files;
  for (const name of readdirSync(folder)) {
    files.set(name, readFileSync(join(folder, name), 'utf8'));
  }
  return files;
}

// Line endings are normalised on both sides. Which one a fixture happens to be
// checked out with is not what any of these cases is testing.
function normalise(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

describe('conformance', () => {
  const cases = casesIn('conformance');

  it('finds the conformance cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const name of cases) {
    it(name, async () => {
      const caseDir = join(root, 'conformance', name);
      const program = readFileSync(join(caseDir, 'program.pseudo'), 'utf8');
      const stdin = read(join(caseDir, 'stdin.txt'));
      const expected = read(join(caseDir, 'expected.txt')) ?? '';
      const args = JSON.parse(read(join(caseDir, 'args.json')) ?? '{}') as CaseArgs;

      const input = stdin === undefined ? [] : normalise(stdin).split('\n');
      if (input.at(-1) === '') input.pop();

      const host = new TestHost(input, args.seed ?? 1, inputFiles(caseDir));
      const source = new SourceFile(`${name}/program.pseudo`, program);
      const result = await runSource(source, host, {
        strictDeclarations: args.strictDeclarations ?? false,
        ...(args.maxCallDepth === undefined ? {} : { maxCallDepth: args.maxCallDepth }),
        ...(args.randomFileRecordSize === undefined
          ? {}
          : { randomFileRecordSize: args.randomFileRecordSize }),
      });

      if (!result.ok) {
        throw new Error(`${name} failed:\n${renderAll(result.errors, source)}`);
      }
      expect(normalise(host.text)).toBe(normalise(expected));

      const expectedFiles = join(caseDir, 'expected-files');
      if (existsSync(expectedFiles)) {
        for (const fileName of readdirSync(expectedFiles)) {
          const want = normalise(readFileSync(join(expectedFiles, fileName), 'utf8'));
          const got = normalise(host.fileContents(fileName) ?? '');
          expect(got, `${name}: ${fileName}`).toBe(want);
        }
      }
    });
  }
});

describe('diagnostics', () => {
  const cases = casesIn('errors');

  it('finds the error cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const name of cases) {
    // The rendered text is pinned on purpose. Message quality is a feature of
    // this project, so a change to the wording should be a visible diff.
    it(name, async () => {
      const caseDir = join(root, 'errors', name);
      const program = readFileSync(join(caseDir, 'program.pseudo'), 'utf8');
      const expected = read(join(caseDir, 'expected.txt')) ?? '';
      const args = JSON.parse(read(join(caseDir, 'args.json')) ?? '{}') as CaseArgs;
      const stdin = read(join(caseDir, 'stdin.txt'));

      const input = stdin === undefined ? [] : normalise(stdin).split('\n');
      if (input.at(-1) === '') input.pop();

      const host = new TestHost(input, args.seed ?? 1, inputFiles(caseDir));
      const source = new SourceFile('program.pseudo', program);
      const result = await runSource(source, host, {
        strictDeclarations: args.strictDeclarations ?? false,
      });

      const reported = [...result.errors, ...result.warnings];
      expect(reported.length, `${name} produced no diagnostic`).toBeGreaterThan(0);
      expect(normalise(renderAll(reported, source)).trimEnd()).toBe(normalise(expected).trimEnd());

      // The folder name starts with the code it is pinning, so a case cannot
      // quietly drift onto a different diagnostic.
      expect(reported[0]?.code).toBe(name.split('-')[0]);
    });
  }
});

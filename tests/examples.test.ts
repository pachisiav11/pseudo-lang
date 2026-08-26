import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceFile, TestHost, parseSource, runSource } from '@pseudo-lang/core';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = join(root, 'examples');
const examples = readdirSync(examplesDir).filter((name) => name.endsWith('.pseudo'));

// Whatever the README shows a student has to actually work. These run the
// shipped examples so a language change cannot quietly break them.
const inputs: Record<string, string[]> = {
  'hello.pseudo': ['Ada'],
};

describe('the example programs', () => {
  it('finds every example', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  for (const name of examples) {
    it(`parses ${name} without a diagnostic`, () => {
      const source = new SourceFile(name, readFileSync(join(examplesDir, name), 'utf8'));
      const result = parseSource(source);
      expect(result.errors.map((e) => `${e.code} ${e.message}`)).toEqual([]);
      expect(result.warnings.map((e) => `${e.code} ${e.message}`)).toEqual([]);
    });

    it(`runs ${name} to completion`, async () => {
      const source = new SourceFile(name, readFileSync(join(examplesDir, name), 'utf8'));
      const host = new TestHost(inputs[name] ?? [], 1);
      const result = await runSource(source, host);
      expect(result.errors.map((e) => `${e.code} ${e.message}`)).toEqual([]);
      expect(result.ok).toBe(true);
      expect(host.text.length).toBeGreaterThan(0);
    });
  }
});

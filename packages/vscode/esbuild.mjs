import { build } from 'esbuild';

const production = process.argv.includes('--production');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

// The extension itself. `vscode` is provided by the host, never bundled.
await build({
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  external: ['vscode'],
});

// A standalone copy of the CLI, so the Run command can execute a program in a
// real terminal and INPUT can read from the keyboard.
await build({
  ...common,
  entryPoints: ['../cli/src/main.ts'],
  outfile: 'dist/pseudo-cli.js',
});

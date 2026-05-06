#!/usr/bin/env bun
import { $ } from 'bun';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const start = performance.now();

console.log('🐰 Building @rabbx/ws...\n');

await $`rm -rf dist`.quiet();
await mkdir('dist/types', { recursive: true });

// Use Bun.build but with bundling: false
const result = await Bun.build({
  entrypoints: ['./src/index.js', './src/server.js'],
  outdir: './dist',
  target: 'node',
  format: 'esm',
  minify: {
    whitespace: true,
    syntax: true,
    identifiers: false // Keep names readable
  },
  splitting: false,
  naming: '[dir]/[name].[ext]',
  external: ['node:*'], // Don't bundle node builtins
});

if (!result.success) {
  console.error('Build failed:', result.logs);
  process.exit(1);
}

// Copy types
await $`cp -r types dist/`.quiet();

// Log sizes
for (const file of ['index.js', 'server.js']) {
  const original = await readFile(join('src', file), 'utf8');
  const minified = await readFile(join('dist', file), 'utf8');
  const origKB = Buffer.byteLength(original) / 1024;
  const minKB = Buffer.byteLength(minified) / 1024;
  const saved = ((1 - minKB / origKB) * 100).toFixed(1);
  console.log(`📦 ${file}: ${origKB.toFixed(2)}KB → ${minKB.toFixed(2)}KB (-${saved}%)`);
}

// Generate package.json
const pkg = await Bun.file('./package.json').json();
const distPkg = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  type: 'module',
  main: './index.js',
  module: './index.js',
  types: './types/index.d.ts',
  exports: {
    ".": {
      "types": "./types/index.d.ts",
      "import": "./index.js"
    },
    "./server": {
      "types": "./types/server.d.ts",
      "import": "./server.js"
    }
  },
  sideEffects: false
};

await Bun.write('dist/package.json', JSON.stringify(distPkg, null, 2));

const time = ((performance.now() - start) / 1000).toFixed(2);
console.log(`\n✅ Done in ${time}s`);
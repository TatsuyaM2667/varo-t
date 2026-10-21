// Verifies dist/ against Cloudflare Pages limits (checked 2026-10-22:
// 25 MiB per file, 20,000 files on the Free plan).
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = process.argv[2] ?? 'dist';
const MAX_FILE = 25 * 1024 * 1024;
const MAX_FILES = 20000;

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(DIST);
let total = 0;
let ok = true;
for (const f of files) {
  const s = statSync(f).size;
  total += s;
  if (s > MAX_FILE) {
    console.error(`✗ ${relative(DIST, f)} is ${(s / 1048576).toFixed(1)} MiB (> 25 MiB)`);
    ok = false;
  }
}
if (files.length > MAX_FILES) {
  console.error(`✗ ${files.length} files (> ${MAX_FILES})`);
  ok = false;
}
const largest = files.map((f) => [f, statSync(f).size]).sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log(`Pages check: ${files.length} files, ${(total / 1048576).toFixed(2)} MiB total`);
for (const [f, s] of largest) console.log(`  ${(s / 1024).toFixed(0).padStart(7)} KiB  ${relative(DIST, f)}`);
if (!ok) process.exit(1);
console.log('✓ within Cloudflare Pages limits');

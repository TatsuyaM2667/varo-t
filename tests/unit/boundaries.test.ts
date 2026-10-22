import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SIM = join(ROOT, 'src/sim');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('module boundaries', () => {
  const files = walk(SIM);

  it('src/sim only imports from src/sim and src/config', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        expect(spec.startsWith('.'), `${relative(ROOT, f)} imports package '${spec}'`).toBe(true);
        const target = relative(ROOT, resolve(dirname(f), spec)).replace(/\\/g, '/');
        expect(target.startsWith('src/sim') || target.startsWith('src/config'), `${relative(ROOT, f)} -> ${target}`).toBe(true);
      }
    }
  });

  it('src/sim uses no non-deterministic or host APIs', () => {
    const banned = [/Math\.random/, /Math\.(sin|cos|tan|atan2?|asin|acos|exp|log|pow|hypot|cbrt)\(/, /\bDate\.now/, /performance\.now/, /\bwindow\./, /\bdocument\./];
    for (const f of files) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const re of banned) expect(re.test(src), `${relative(ROOT, f)} matches ${re}`).toBe(false);
    }
  });
});

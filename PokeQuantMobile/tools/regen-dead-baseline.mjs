// Regenerates tools/lint-dead-baseline.txt after a deliberate dead-export
// removal. Writes utf8 with \n — do NOT do this via shell `>` redirection,
// which produces UTF-16 on Windows PowerShell and makes every baseline
// line look new to check-dead-exports.mjs.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeDeadEntry } from './dead-normalize.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsPrune = join(root, 'node_modules', 'ts-prune', 'lib', 'index.js');
const out = [
  ...new Set(
    execFileSync(process.execPath, [tsPrune, '-p', 'tsconfig.json'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => normalizeDeadEntry(l, root).key),
  ),
].sort();

writeFileSync(join(root, 'tools', 'lint-dead-baseline.txt'), out.join('\n') + '\n', 'utf8');
console.log(`[lint:dead] baseline regenerated — ${out.length} entries`);

// Regenerates tools/lint-dead-baseline.txt after a deliberate dead-export
// removal. Writes utf8 with \n — do NOT do this via shell `>` redirection,
// which produces UTF-16 on Windows PowerShell and makes every baseline
// line look new to check-dead-exports.mjs.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsPrune = join(root, 'node_modules', 'ts-prune', 'lib', 'index.js');
const out = execFileSync(process.execPath, [tsPrune, '-p', 'tsconfig.json'], {
  cwd: root,
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)
  // ts-prune emits absolute paths for files outside the package root —
  // normalize to root-relative so the baseline isn't machine-path-bound.
  // Only real machine paths (drive-letter or UNC) count: ts-prune's
  // in-tree form is `\src\…`, which isAbsolute misreads on Windows.
  .map((l) => {
    const m = l.match(/^(.+?):(\d+ - .*)$/);
    const p = m?.[1];
    return p != null && (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\'))
      ? `${relative(root, p)}:${m[2]}`
      : l;
  })
  .sort();

writeFileSync(
  join(root, 'tools', 'lint-dead-baseline.txt'),
  out.join('\n') + '\n',
  'utf8'
);
console.log(`[lint:dead] baseline regenerated — ${out.length} entries`);

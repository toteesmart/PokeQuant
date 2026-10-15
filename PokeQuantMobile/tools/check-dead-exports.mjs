// lint:dead — ts-prune diffed against tools/lint-dead-baseline.txt.
// The baseline is the known post-refactor dead-export surface (facade
// re-exports, intentional roadmap DAO). Any NEW entry is rot: unexport it
// or delete it. To bless a removal, regenerate the baseline with
//   node tools/regen-dead-baseline.mjs
// (NOT `ts-prune | sort > file` — PowerShell's > writes UTF-16, which this
// file's utf8 read then treats as all-new entries.)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'tools', 'lint-dead-baseline.txt');

// Invoke ts-prune's JS entry directly — spawning npx(.cmd) hits Node's
// .cmd refusal on Windows (CVE-2024-27980) and adds a second of overhead.
const tsPrune = join(root, 'node_modules', 'ts-prune', 'lib', 'index.js');
const current = execFileSync(
  process.execPath,
  [tsPrune, '-p', 'tsconfig.json'],
  { cwd: root, encoding: 'utf8' }
)
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)
  .sort();

const baseline = readFileSync(baselinePath, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);

const baselineSet = new Set(baseline);
const fresh = current.filter((l) => !baselineSet.has(l));
const gone = baseline.filter((l) => !new Set(current).has(l));

if (gone.length) {
  console.log(
    `[lint:dead] ${gone.length} baseline entries resolved — regenerate the baseline:`
  );
  console.log('  node tools/regen-dead-baseline.mjs');
}

if (fresh.length) {
  console.error(`[lint:dead] ${fresh.length} NEW dead export(s):`);
  for (const l of fresh) console.error(`  ${l}`);
  process.exit(1);
}

console.log(
  `[lint:dead] OK — ${current.length} exports checked against baseline, none new.`
);

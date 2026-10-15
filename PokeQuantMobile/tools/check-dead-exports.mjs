// lint:dead — ts-prune diffed against tools/lint-dead-baseline.txt.
// The baseline is the known post-refactor dead-export surface (facade
// re-exports, intentional roadmap DAO). Any NEW entry is rot: unexport it
// or delete it. To bless a removal, regenerate the baseline with
//   npx ts-prune -p tsconfig.json | sort > tools/lint-dead-baseline.txt
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'tools', 'lint-dead-baseline.txt');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const current = execFileSync(
  npx,
  ['ts-prune', '-p', 'tsconfig.json'],
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
  console.log(
    '  npx ts-prune -p tsconfig.json | sort > tools/lint-dead-baseline.txt'
  );
}

if (fresh.length) {
  console.error(`[lint:dead] ${fresh.length} NEW dead export(s):`);
  for (const l of fresh) console.error(`  ${l}`);
  process.exit(1);
}

console.log(
  `[lint:dead] OK — ${current.length} exports checked against baseline, none new.`
);

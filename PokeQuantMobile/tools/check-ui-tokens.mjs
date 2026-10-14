#!/usr/bin/env node
// UI token linter — the deterministic half of UI verification.
// Flags raw color literals, off-scale fontSize/borderRadius, and 'bold'
// weights outside the token files. Escape a justified case with a
// `// token-ok` comment on the same line (document why).
//
// Usage: node tools/check-ui-tokens.mjs   (npm run lint:ui)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

// Token definitions live here — exempt by design.
const EXEMPT = new Set(
  [
    'src/constants/colors.ts',
    'src/constants/theme.ts',
    'src/constants/shows.ts',
  ].map((p) => p.split('/').join(sep))
);

const SKIP_DIRS = new Set(['__tests__', 'node_modules']);

const FONT_SCALE = new Set([9, 10, 11, 12, 13, 14, 15, 16, 18, 24]);
const RADIUS_SCALE = new Set([4, 6, 8, 10, 12, 16, 20, 999]);

const RULES = [
  {
    name: 'hex-color',
    re: /['"`]#[0-9a-fA-F]{3,8}\b/g,
    msg: 'raw hex literal — use colors.*',
  },
  {
    name: 'rgba-color',
    re: /['"`]?rgba\(\s*\d/g,
    msg: 'raw rgba() — use colors.* tints/overlays/scrims',
  },
  {
    name: 'named-color',
    re: /color:\s*['"](white|black|red|green|blue|grey|gray|yellow|orange|purple|pink)\b/gi,
    msg: 'named color — use colors.*',
  },
  {
    name: 'font-size',
    re: /fontSize:\s*(\d+(?:\.\d+)?)/g,
    check: (m) => !FONT_SCALE.has(Number(m[1])),
    msg: `off-scale fontSize — allowed: ${[...FONT_SCALE].join(', ')}`,
  },
  {
    name: 'radius',
    re: /Radius:\s*(\d+(?:\.\d+)?)/g,
    check: (m) => !RADIUS_SCALE.has(Number(m[1])),
    msg: `off-scale radius — allowed: ${[...RADIUS_SCALE].join(', ')}`,
  },
  {
    name: 'font-weight',
    re: /fontWeight:\s*['"]bold['"]/g,
    msg: "'bold' — use '700' or weight.bold",
  },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield full;
    }
  }
}

const violations = [];

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (EXEMPT.has(rel)) continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes('token-ok')) return;
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        if (rule.check && !rule.check(m)) continue;
        violations.push({
          file: rel,
          line: i + 1,
          rule: rule.name,
          text: line.trim().slice(0, 100),
          msg: rule.msg,
        });
      }
    }
  });
}

if (violations.length === 0) {
  console.log('lint:ui — clean. All style literals are token-compliant.');
  process.exit(0);
}

const byFile = new Map();
for (const v of violations) {
  if (!byFile.has(v.file)) byFile.set(v.file, []);
  byFile.get(v.file).push(v);
}

for (const [file, list] of byFile) {
  console.log(`\n${file}`);
  for (const v of list) {
    console.log(`  :${v.line}  [${v.rule}] ${v.msg}`);
    console.log(`        ${v.text}`);
  }
}

console.log(`\n${violations.length} violation(s) in ${byFile.size} file(s).`);
console.log('Fix: use colors.*/theme tokens, or justify with `// token-ok`.');
process.exit(1);

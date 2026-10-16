#!/usr/bin/env node
// One-shot codemod: replaces raw style literals with token references
// (colors.*) and snaps off-scale fontSize/borderRadius/fontWeight to the
// theme scale. Idempotent — safe to re-run.
//
//   node tools/codemod-tokens.mjs        apply
//   node tools/codemod-tokens.mjs --dry  print planned edits only

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const DRY = process.argv.includes('--dry');

const SKIP = new Set(
  ['src/constants/colors.ts', 'src/constants/theme.ts', 'src/constants/shows.ts'].map((p) =>
    p.split('/').join(sep),
  ),
);

// --- Literal → token maps (keys normalized: lowercase hex, compact rgba) --
const HEX = {
  '#c9d1d9': 'text',
  '#30363d': 'border',
  '#fff': 'onAccent',
  '#ffffff': 'onAccent',
  '#8b949e': 'textMuted',
  '#161b22': 'surface',
  '#1f242c': 'surfaceLight',
  '#e8b94a': 'accentGold',
  '#10151c': 'sheet',
  '#0e1117': 'background',
  '#238636': 'primary',
  '#3b82f6': 'primary',
  '#17253a': 'primaryActive',
  '#1c2431': 'primaryActive',
  '#d29922': 'warning',
  '#ef4444': 'error',
  '#c93c37': 'error',
  '#22c55e': 'success',
  '#a371f7': 'accentPurple',
  '#6e7681': 'textMuted',
  '#2ea043': 'chartGreen',
  '#3fb950': 'velocityPositive',
  '#ff7b72': 'velocityNegative',
  '#0b0f14': 'surfaceDeep',
  '#000': 'black',
  '#000000': 'black',
};

const RGBA = {
  'rgba(255,255,255,0.04)': 'overlay1',
  'rgba(255,255,255,0.05)': 'overlay2',
  'rgba(255,255,255,0.06)': 'overlay2',
  'rgba(255,255,255,0.07)': 'overlay3',
  'rgba(255,255,255,0.08)': 'overlay3',
  'rgba(255,255,255,0.1)': 'overlay4',
  'rgba(255,255,255,0.12)': 'overlay5',
  'rgba(255,255,255,0.25)': 'overlayStrong',
  'rgba(255,255,255,0.4)': 'overlayBright',
  'rgba(0,0,0,0.55)': 'backdrop',
  'rgba(0,0,0,0.6)': 'backdrop',
  'rgba(0,0,0,0.65)': 'backdrop',
  'rgba(0,0,0,0.7)': 'backdropHeavy',
  'rgba(0,0,0,0.96)': 'scrimOpaque',
  'rgba(59,130,246,0.08)': 'primarySoft',
  'rgba(59,130,246,0.12)': 'primaryTint',
  'rgba(59,130,246,0.15)': 'primaryStrong',
  'rgba(34,197,94,0.12)': 'successTint',
  'rgba(34,197,94,0.15)': 'successTintStrong',
  'rgba(34,197,94,0.35)': 'successHighlight',
  'rgba(239,68,68,0.10)': 'errorTint',
  'rgba(239,68,68,0.12)': 'errorTint',
  'rgba(239,68,68,0.15)': 'errorTintStrong',
  'rgba(210,153,34,0.12)': 'warningTint',
  'rgba(210,153,34,0.18)': 'warningTintStrong',
  'rgba(14,17,23,0.85)': 'scrimDark',
  'rgba(14,17,23,0.9)': 'scrimDark',
  'rgba(10,12,15,0.75)': 'scrimDeep',
  'rgba(10,12,15,0.85)': 'scrimDeep',
  'rgba(10,12,15,0.9)': 'scrimDeep',
  'rgba(4,6,10,0.55)': 'backdrop',
  'rgba(101,67,246,0.08)': 'proTint',
  'rgba(101,67,246,0.15)': 'proTintStrong',
  'rgba(46,160,67,0.12)': 'chartGreenTint',
  'rgba(232,185,74,0.08)': 'accentGoldTint',
};

// Snap to scale — documented deltas (see UI_PRINCIPLES.md "snap policy").
const FONT_MAP = {
  8: 9,
  10.5: 10,
  11.5: 12,
  12.5: 12,
  17: 16,
  20: 18,
  21: 24,
  22: 24,
  28: 24,
  32: 24,
};
const RADIUS_MAP = {
  2: 4,
  3: 4,
  5: 6,
  7: 8,
  9: 10,
  11: 10,
  14: 12,
  17: 16,
  18: 20,
  22: 20,
  24: 20,
  29: 999,
  36: 999,
  40: 999,
  50: 999,
  100: 999,
};
const FONT_ON_SCALE = new Set([9, 10, 11, 12, 13, 14, 15, 16, 18, 24]);
const RADIUS_ON_SCALE = new Set([4, 6, 8, 10, 12, 16, 20, 999]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield full;
    }
  }
}

let totalEdits = 0;
const changedFiles = [];

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (SKIP.has(rel)) continue;

  const original = readFileSync(file, 'utf8');
  let src = original;
  let edits = 0;

  // 1) JSX attributes: prop={"#hex"} or prop='#hex' -> prop={colors.X}
  //    Requires an identifier char immediately before '=' — a spaced '='
  //    is a JS assignment, not an attribute. Inner gaps allow [ \t] only
  //    so the newline after an attribute is never consumed.
  src = src.replace(
    /([A-Za-z0-9])=([ \t]*)\{?[ \t]*(['"])(#[0-9a-fA-F]{3,8})\3[ \t]*\}?/g,
    (m, pre, sp, q, hex) => {
      const token = HEX[hex.toLowerCase()];
      if (!token) return m;
      edits++;
      return `${pre}={colors.${token}}`;
    },
  );

  // 2) Remaining quoted hex literals: '#hex' -> colors.X
  src = src.replace(/(['"])(#[0-9a-fA-F]{3,8})\1/g, (m, q, hex) => {
    const token = HEX[hex.toLowerCase()];
    if (!token) return m;
    edits++;
    return `colors.${token}`;
  });

  // 3) JSX attributes: prop={"rgba(...)"} -> prop={colors.X}
  //    Same guards as rule 1.
  src = src.replace(
    /([A-Za-z0-9])=([ \t]*)\{?[ \t]*(['"])rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)\3[ \t]*\}?/g,
    (m, pre, sp, q, r, g, b, a) => {
      const key = `rgba(${r},${g},${b},${a})`;
      const token = RGBA[key];
      if (!token) return m;
      edits++;
      return `${pre}={colors.${token}}`;
    },
  );

  // 4) Remaining quoted rgba literals: 'rgba(...)' -> colors.X
  src = src.replace(
    /(['"])rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)\1/g,
    (m, q, r, g, b, a) => {
      const key = `rgba(${r},${g},${b},${a})`;
      const token = RGBA[key];
      if (!token) return m;
      edits++;
      return `colors.${token}`;
    },
  );

  // 5) fontWeight 'bold' -> '700' (style objects and JSX attrs)
  src = src.replace(/fontWeight:\s*'bold'/g, () => {
    edits++;
    return "fontWeight: '700'";
  });
  src = src.replace(/fontWeight="bold"/g, () => {
    edits++;
    return 'fontWeight="700"';
  });

  // 6) Off-scale fontSize / border*Radius -> snap to scale
  src = src.replace(/fontSize:\s*(\d+(?:\.\d+)?)/g, (m, n) => {
    const num = Number(n);
    if (FONT_ON_SCALE.has(num) || !(num in FONT_MAP)) return m;
    edits++;
    return `fontSize: ${FONT_MAP[num]}`;
  });
  src = src.replace(/Radius:\s*(\d+(?:\.\d+)?)/g, (m, n) => {
    const num = Number(n);
    if (RADIUS_ON_SCALE.has(num) || !(num in RADIUS_MAP)) return m;
    edits++;
    return `Radius: ${RADIUS_MAP[num]}`;
  });

  // 7) Inject the colors import where the file now references it.
  if (
    /colors\./.test(src) &&
    !/import\s*{[^}]*\bcolors\b[^}]*}\s*from\s*['"][^'"]*colors['"]/.test(src)
  ) {
    const dir = dirname(file);
    const relPath = relative(dir, join(SRC, 'constants')).split(sep).join('/') + '/colors';
    const importLine = `import { colors } from '${relPath}';\n`;
    const lastImport = src.lastIndexOf('\nimport ');
    const firstImport = src.indexOf('import ');
    if (lastImport >= 0) {
      const eol = src.indexOf('\n', lastImport + 1);
      src = src.slice(0, eol + 1) + importLine + src.slice(eol + 1);
    } else if (firstImport >= 0) {
      src = importLine + src;
    } else {
      src = importLine + '\n' + src;
    }
    edits++;
  }

  if (edits > 0 && src !== original) {
    totalEdits += edits;
    changedFiles.push(`${rel} (+${edits})`);
    if (!DRY) writeFileSync(file, src);
  }
}

console.log(`${DRY ? '[dry] ' : ''}${totalEdits} edit(s) across ${changedFiles.length} file(s)`);
for (const f of changedFiles) console.log(`  ${f}`);

// Pins for tools/queue-contract.mjs + the check-queue-contract.mjs
// runner — the mechanized WORK_QUEUE session contract (item 52). Both
// are .mjs, which jest's transform never touches, so the pure functions
// are exercised through a real node subprocess — same pattern as
// deadNormalize.test.ts. The git plumbing is pinned end-to-end against
// a throwaway repo in tmpdir so no assertion depends on this clone's
// history (CI checks out depth-1 — the real commits wouldn't exist).

/* eslint-disable @typescript-eslint/no-require-imports -- node builtins via CJS require; no node type declarations in this setup */
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
/* eslint-enable @typescript-eslint/no-require-imports */

declare const __dirname: string;

const toolPath = join(__dirname, '..', 'tools', 'check-queue-contract.mjs');
const libUrl = pathToFileURL(join(__dirname, '..', 'tools', 'queue-contract.mjs')).href;

const evalModule = (expr: string): unknown =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import * as QC from ${JSON.stringify(libUrl)};` +
          `process.stdout.write(JSON.stringify(${expr}));`,
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    ),
  );

const isGatedPath = (paths: string[]): boolean[] =>
  evalModule(`${JSON.stringify(paths)}.map((p) => QC.isGatedPath(p))`) as boolean[];

const parseItemRefs = (msg: string): number[] =>
  evalModule(`[...QC.parseItemRefs(${JSON.stringify(msg)})]`) as number[];

const flippedItemIds = (diff: string): number[] =>
  evalModule(`[...QC.flippedItemIds(${JSON.stringify(diff)})]`) as number[];

type Violation = { rule: string; message: string };
type Commit = { files: string[]; message: string; queueDiff?: string };
const checkCommit = (commit: Commit): Violation[] =>
  evalModule(`QC.checkCommit(${JSON.stringify(commit)})`) as Violation[];

const flipDiff = (...ids: number[]) =>
  ids.map((n) => `-## [ ] ${n}. T\n+## [x] ${n}. T\n`).join('');

describe('isGatedPath', () => {
  it('gates src/, root worker*.js, and the vendored worker tree', () => {
    const gated = [
      'PokeQuantMobile/src/app.ts',
      'PokeQuantMobile/src/scanner/services/deal/deep/x.ts',
      'worker.js',
      'worker_pre_show.js',
      'worker_show_vendor.js',
      'workers.js',
      'worker_show_vendor/auth.js',
      'worker_show_vendor/handlers/nested/x.js',
    ];
    expect(isGatedPath(gated)).toEqual(gated.map(() => true));
  });

  it('leaves everything else ungated', () => {
    const ungated = [
      'PokeQuantMobile/tools/check-queue-contract.mjs',
      'PokeQuantMobile/__tests__/x.test.ts',
      'PokeQuantMobile/docs/RELEASE.md',
      'PokeQuantMobile/.devin/WORK_QUEUE.md',
      'PokeQuantMobile/package.json',
      'PokeQuantMobile/App.tsx',
      'PokeQuantMobile/worker.js',
      '.github/workflows/mobile-ci.yml',
      'wrangler.jsonc',
      'worker_show_vendor.jsonc',
      'worker_show_vendor',
      'x/worker.js',
      'myworker.js',
      'worker.jsx',
      'app.py',
    ];
    expect(isGatedPath(ungated)).toEqual(ungated.map(() => false));
  });
});

describe('parseItemRefs', () => {
  it('extracts unique item ids in order of appearance', () => {
    expect(parseItemRefs('feat: x (item 52)')).toEqual([52]);
    expect(parseItemRefs('a (item 52) b (item 45) c (item 52)')).toEqual([52, 45]);
  });

  it('rejects non-contract spellings', () => {
    for (const m of ['no ref', 'item 52', '(Item 52)', '(items 52)', '(item)']) {
      expect(parseItemRefs(m)).toEqual([]);
    }
  });
});

describe('flippedItemIds', () => {
  it('detects an unchecked heading gaining its checked twin', () => {
    expect(flippedItemIds(flipDiff(52))).toEqual([52]);
    expect(flippedItemIds(flipDiff(5, 52))).toEqual([5, 52]);
  });

  it('accepts deeper heading levels and an uppercase box', () => {
    expect(flippedItemIds('-#### [ ] 7. T\n+### [X] 7. T\n')).toEqual([7]);
  });

  it('ignores one-sided, same-state, and context/header lines', () => {
    // added-already-checked only (new item landed checked — no flip)
    expect(flippedItemIds('+## [x] 52. T\n')).toEqual([]);
    // removed-unchecked only (item deleted while open — no flip)
    expect(flippedItemIds('-## [ ] 52. T\n')).toEqual([]);
    // checked → checked heading edit is not a flip
    expect(flippedItemIds('-## [x] 52. old\n+## [x] 52. new\n')).toEqual([]);
    // context lines (leading space) and +++/--- file headers
    expect(flippedItemIds(' ## [ ] 52. T\n+++ b/## [x] 52. T\n')).toEqual([]);
    expect(flippedItemIds('')).toEqual([]);
  });

  it('distinguishes item numbers across digit boundaries', () => {
    // A flip of item 5 must not satisfy a commit naming item 52.
    expect(flippedItemIds(flipDiff(5))).toEqual([5]);
  });
});

describe('checkCommit', () => {
  const SRC = ['PokeQuantMobile/src/x.ts'];

  it('passes a gated commit naming an item whose box flipped', () => {
    expect(
      checkCommit({ files: SRC, message: 'feat: x (item 52)', queueDiff: flipDiff(52) }),
    ).toEqual([]);
  });

  it('passes any commit carrying the explicit escape, even with a ref', () => {
    const msg = 'hotfix (item 52) (no queue item)';
    expect(checkCommit({ files: SRC, message: msg })).toEqual([]);
    expect(checkCommit({ files: SRC, message: 'hotfix (no queue item)' })).toEqual([]);
  });

  it('skips commits touching no gated path, ref or not', () => {
    expect(checkCommit({ files: ['PokeQuantMobile/docs/x.md'], message: 'docs' })).toEqual([]);
    expect(checkCommit({ files: ['worker.js.map'], message: 'docs (item 52)' })).toEqual([]);
  });

  it('flags a gated commit with no ref and no escape', () => {
    const [v] = checkCommit({ files: SRC, message: 'feat: raw src change' });
    expect(v.rule).toBe('missing-item-ref');
    expect(v.message).toContain('PokeQuantMobile/src/x.ts');
  });

  it('flags a gated commit whose named item box did not flip', () => {
    // no queue diff at all
    const [v] = checkCommit({ files: SRC, message: 'feat: x (item 52)' });
    expect(v.rule).toBe('box-not-flipped');
    expect(v.message).toContain('(item 52)');
    // a different item flipped
    const [w] = checkCommit({ files: SRC, message: 'feat: x (item 52)', queueDiff: flipDiff(51) });
    expect(w.rule).toBe('box-not-flipped');
  });

  it('passes when any named item flips (incidental refs tolerated)', () => {
    expect(
      checkCommit({
        files: SRC,
        message: 'pins the harness from (item 45) while landing (item 52)',
        queueDiff: flipDiff(52),
      }),
    ).toEqual([]);
  });

  it('treats worker_show_vendor/** and root worker*.js identically', () => {
    for (const file of ['worker.js', 'worker_show_vendor/handlers/x.js']) {
      const [v] = checkCommit({ files: [file], message: 'ungated wording' });
      expect(v.rule).toBe('missing-item-ref');
    }
  });
});

// --- end-to-end over real git plumbing ------------------------------------
// Six commits in a tmpdir repo exercise diff-tree/show/log through the CLI.
// History: A seed (ungated) → B lands item 51 → C docs-only → D worker fix
// via escape → E src with no ref (FAIL) → F gated, names 52, no flip (FAIL)
// → G gated, names 52 but flips 53 (FAIL) → H docs (skip, keeps HEAD clean).

describe('cli over a real git repo', () => {
  let repo: string;
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const commit = (files: Record<string, string>, message: string) => {
    for (const [p, body] of Object.entries(files)) {
      const full = join(repo, p);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, body);
    }
    git(['add', '-A']);
    git(['commit', '-m', message]);
    return git(['rev-parse', 'HEAD']).trim();
  };
  const runCli = (args: string[]) => {
    try {
      const stdout = execFileSync(process.execPath, [toolPath, ...args], {
        cwd: repo,
        encoding: 'utf8',
      });
      return { code: 0, stdout, stderr: '' };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
  };

  let seed = '';
  const queue = (boxes: string) => `# Work Queue\n\n${boxes}\n`;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'queue-contract-'));
    git(['init', '-q']);
    git(['config', 'user.email', 'test@test']);
    git(['config', 'user.name', 'test']);
    seed = commit(
      {
        'PokeQuantMobile/.devin/WORK_QUEUE.md': queue('## [ ] 51. A\n## [ ] 52. B\n## [ ] 53. C'),
        'PokeQuantMobile/src/app.ts': 'export const a = 1;',
        'worker.js': 'export default {};',
        'worker_show_vendor/auth.js': 'export const x = 1;',
        'README.md': 'hi',
      },
      'seed',
    );
    commit(
      {
        'PokeQuantMobile/.devin/WORK_QUEUE.md': queue('## [x] 51. A\n## [ ] 52. B\n## [ ] 53. C'),
        'PokeQuantMobile/src/app.ts': 'export const a = 2;',
      },
      'land the thing (item 51)',
    );
    commit({ 'docs/notes.md': 'd' }, 'docs only');
    commit({ 'worker.js': 'export default { x: 1 };' }, 'worker fix (no queue item)');
    commit({ 'PokeQuantMobile/src/b.ts': 'export const b = 1;' }, 'src change, no ref');
    commit({ 'worker_show_vendor/auth.js': 'export const x = 2;' }, 'vendor edit (item 52)');
    commit(
      {
        'PokeQuantMobile/src/c.ts': 'export const c = 1;',
        'PokeQuantMobile/.devin/WORK_QUEUE.md': queue('## [x] 51. A\n## [ ] 52. B\n## [x] 53. C'),
      },
      'flipped the wrong box (item 52)',
    );
    commit({ 'docs/more.md': 'd' }, 'docs again');
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('reports the full push range and fails once per violating commit', () => {
    const r = runCli([`${seed}..HEAD`]);
    expect(r.code).toBe(1);
    const fails = r.stderr.split('\n').filter((l) => l.startsWith('[FAIL]'));
    expect(fails).toHaveLength(3);
    // rev-list prints newest first: G (wrong box), F (no flip), E (no ref)
    expect(fails[0]).toContain('flipped the wrong box');
    expect(fails[0]).toContain('box-not-flipped');
    expect(fails[1]).toContain('vendor edit');
    expect(fails[1]).toContain('box-not-flipped');
    expect(fails[2]).toContain('src change, no ref');
    expect(fails[2]).toContain('missing-item-ref');
    // clean commits still report their disposition
    expect(r.stdout).toContain('[ok]');
    expect(r.stdout).toContain('[skip]');
    expect(r.stdout).toContain('land the thing (item 51)');
    expect(r.stdout).toContain('worker fix (no queue item)');
    expect(r.stderr).toContain('3 violation(s) across 7 commit(s)');
  });

  it('passes a clean single-commit range', () => {
    // rev-list is newest-first; the (item 51) commit is the oldest in range
    const land = git(['rev-list', `${seed}..HEAD`])
      .trim()
      .split('\n')
      .at(-1);
    const r = runCli([`${land}~1..${land}`]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('land the thing (item 51)');
  });

  it('checks HEAD alone when no base is given', () => {
    const r = runCli([]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('[skip]');
    expect(r.stdout).toContain('docs again');
  });

  it('treats an empty range as a clean pass', () => {
    const r = runCli(['HEAD']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('empty push range');
  });
});

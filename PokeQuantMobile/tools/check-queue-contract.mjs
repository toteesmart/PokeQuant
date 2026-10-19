// check-queue-contract — mechanizes the WORK_QUEUE session contract
// (PokeQuantMobile/.devin/WORK_QUEUE.md) for CI. Rule logic lives in
// ./queue-contract.mjs; this file is the git plumbing + CLI.
//
// Usage:  node tools/check-queue-contract.mjs [before]
//   before = push-range base (github.event.before). Empty, missing, or
//   all-zeros → check HEAD only. A `before` containing `..` is passed to
//   git rev-list verbatim (lets tests pin a single historical commit via
//   `<sha>^..<sha>`). An unresolvable `before` warns and degrades to
//   HEAD-only rather than failing blind — the gate runs advisory, so a
//   force-pushed or shallow-missing base shouldn't mute the signal.
//
// Exit: 0 clean, 1 contract violation(s), 2 operational error.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { checkCommit, isGatedPath, QUEUE_FILE } from './queue-contract.mjs';

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// One commit's checkable surface: touched paths (repo-root relative —
// bare `git diff-tree` reports nothing for merges, which are therefore
// exempt), the full message, and the queue file's own diff.
const commitInfo = (root, sha) => ({
  sha,
  files: git(['diff-tree', '--root', '-r', '--no-commit-id', '--name-only', sha], root)
    .split('\n')
    .filter(Boolean),
  message: git(['log', '-1', '--format=%B', sha], root),
  queueDiff: git(['show', '--format=', sha, '--', QUEUE_FILE], root),
});

const resolveShas = (root, before) => {
  if (!before || /^0+$/.test(before)) return ['HEAD'];
  const spec = before.includes('..') ? before : `${before}..HEAD`;
  try {
    return git(['rev-list', spec], root).split('\n').filter(Boolean);
  } catch {
    console.error(`queue-contract: cannot resolve '${spec}' — checking HEAD only`);
    return ['HEAD'];
  }
};

const main = () => {
  const before = process.argv[2] || process.env.QUEUE_CHECK_BEFORE || '';
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const shas = resolveShas(root, before);
  if (!shas.length) {
    console.log('queue-contract: empty push range — nothing to check');
    return 0;
  }
  let failures = 0;
  for (const sha of shas) {
    const info = commitInfo(root, sha);
    const violations = checkCommit(info);
    const short = sha.slice(0, 7);
    const subject = info.message.split('\n', 1)[0].trim();
    if (!violations.length) {
      console.log(`[${info.files.some(isGatedPath) ? 'ok' : 'skip'}] ${short} ${subject}`);
      continue;
    }
    failures += violations.length;
    for (const v of violations)
      console.error(`[FAIL] ${short} ${subject} — ${v.rule}: ${v.message}`);
  }
  if (failures) {
    console.error(`queue-contract: ${failures} violation(s) across ${shas.length} commit(s)`);
    return 1;
  }
  console.log(`queue-contract: OK — ${shas.length} commit(s) checked`);
  return 0;
};

const invokedAsScript =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedAsScript) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(`queue-contract: ${e && e.message ? e.message : e}`);
    process.exitCode = 2;
  }
}

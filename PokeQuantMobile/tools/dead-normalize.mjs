// Canonical dead-export keys, shared by check-dead-exports.mjs and
// regen-dead-baseline.mjs so the two tools can never drift.
//
// Canonical key = `relpath - name`: forward slashes, root-relative, no
// line number — a line shift must not manufacture false new+resolved
// pairs — and ` (used in module)` preserved as part of the name side.
// `display` keeps `file:line - name` purely for locate-ability; nothing
// compares on it.
//
// ts-prune emits `abs.replace(cwd, '').replace(/^/, '')` (presenter.js),
// so the path shapes reaching us are:
//   Windows in-tree       \src\foo.ts         (cwd stripped, '\' kept)
//   POSIX in-tree         src/foo.ts          (cwd + '/' both stripped)
//   Windows out-of-tree   C:\repo\worker\x.js (untouched absolute)
//   POSIX out-of-tree     home/u/worker/x.js  ('/'-stripped absolute!)
// The last form lost its leading slash to the `^/` strip, so it arrives
// looking relative; it's recovered because a stripped absolute still
// shares its first segment with the package root (both live under the
// same workspace dir) while a real in-tree relative path never can —
// in-tree paths were already cwd-stripped.
const DRIVE_OR_UNC = /^([a-zA-Z]:[\\/]|\\\\)/;

// Forward-slash, segment-wise relativize. path.relative is platform-bound
// (a `C:\` path on POSIX resolves against cwd), and the point of the
// canonical key is that Windows and Linux emit identical strings.
const relPath = (from, to) => {
  const segs = (s) => s.replace(/\\/g, '/').split('/').filter(Boolean);
  const f = segs(from);
  const t = segs(to);
  let i = 0;
  while (i < f.length && i < t.length && f[i].toLowerCase() === t[i].toLowerCase()) i++;
  return [...Array(f.length - i).fill('..'), ...t.slice(i)].join('/');
};

export const normalizeDeadEntry = (line, root) => {
  const m = line.match(/^(.*?):(\d+)( - .*)$/);
  if (!m || !m[1]) return { key: line, display: line };
  const [, rawPath, lineNo, rest] = m;
  const rootF = root.replace(/\\/g, '/').replace(/\/+$/, '');
  let p = rawPath.replace(/\\/g, '/');
  if (DRIVE_OR_UNC.test(rawPath) || rawPath.startsWith('/')) {
    p = relPath(rootF, p);
  } else if (!p.startsWith('/')) {
    // `\src\…` (leading sep after slash conversion) is already
    // root-relative. The remaining bare form is either POSIX in-tree or a
    // '/'-stripped POSIX absolute — the latter iff it shares root's
    // first segment (see header comment).
    const first = (s) => s.replace(/^\/+/, '').split('/')[0].toLowerCase();
    if (first(p) === first(rootF)) p = relPath(rootF, `/${p}`);
  }
  p = p.replace(/^\/+/, '');
  return { key: `${p}${rest}`, display: `${p}:${lineNo}${rest}` };
};

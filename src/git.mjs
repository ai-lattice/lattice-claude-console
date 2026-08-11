// Work-product engine: what did the agent actually change in a repo?
// This is the layer claude agents / iTerm / tmux don't have — the diff, the
// files, the commits an agent produced — so you review the WORK, not the status.
// All calls are execFile arrays (never shelled), scoped to a validated cwd,
// with hard output caps so a huge diff can't blow up the server.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

function git(cwd, args, { max = 2 * 1024 * 1024 } = {}) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8', maxBuffer: max, timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function isRepo(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return false;
  return git(cwd, ['rev-parse', '--is-inside-work-tree']) ?.trim() === 'true';
}

// Parse `git diff --numstat` → per-file added/removed + a coarse status.
function numstat(cwd, args) {
  const out = git(cwd, ['diff', '--numstat', ...args]);
  if (!out) return [];
  return out.trim().split('\n').filter(Boolean).map((line) => {
    const [add, del, ...rest] = line.split('\t');
    const path = rest.join('\t');
    return {
      path,
      added: add === '-' ? null : Number(add),   // '-' = binary
      removed: del === '-' ? null : Number(del),
    };
  });
}

// Untracked files the agent created (not in any diff yet).
function untracked(cwd) {
  const out = git(cwd, ['ls-files', '--others', '--exclude-standard']);
  if (!out) return [];
  return out.trim().split('\n').filter(Boolean);
}

function recentCommits(cwd, n = 8) {
  // %H hash, %h short, %s subject, %cr relative date, %an author, %(trailers) for Co-Authored-By
  const out = git(cwd, ['log', `-n${n}`, '--pretty=format:%h\x1f%s\x1f%cr\x1f%an\x1f%(trailers:key=Co-Authored-By,valueonly)']);
  if (!out) return [];
  return out.trim().split('\n').filter(Boolean).map((line) => {
    const [hash, subject, when, author, trailers] = line.split('\x1f');
    return { hash, subject, when, author, byClaude: /claude/i.test(trailers || '') || /claude/i.test(author || '') };
  });
}

// Summary of a repo's current work product: uncommitted changes + recent commits.
export function repoState(cwd) {
  if (!isRepo(cwd)) return { isRepo: false };
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() || null;

  // Uncommitted: staged + unstaged tracked changes, plus untracked files.
  const tracked = numstat(cwd, ['HEAD']); // working tree vs HEAD (staged+unstaged)
  const news = untracked(cwd).map((path) => ({ path, added: null, removed: null, untracked: true }));
  const files = [...tracked, ...news];

  let insertions = 0, deletions = 0;
  for (const f of tracked) { insertions += f.added || 0; deletions += f.removed || 0; }

  // Ahead/behind upstream — did the agent commit work not yet pushed?
  let ahead = 0;
  const counts = git(cwd, ['rev-list', '--count', '--left-right', '@{upstream}...HEAD']);
  if (counts) { const m = counts.trim().split(/\s+/); ahead = Number(m[1]) || 0; }

  return {
    isRepo: true,
    branch,
    dirty: files.length > 0,
    diffstat: { files: files.length, insertions, deletions },
    files: files.slice(0, 80),
    filesTruncated: Math.max(0, files.length - 80),
    aheadCount: ahead, // unpushed commits
    commits: recentCommits(cwd),
  };
}

// Full unified diff for review, capped. Includes untracked files (shown as
// new-file diffs) so the agent's brand-new code is reviewable too.
export function repoDiff(cwd, { max = 600 * 1024 } = {}) {
  if (!isRepo(cwd)) return { isRepo: false, diff: '' };
  let diff = git(cwd, ['diff', 'HEAD'], { max }) || '';
  // Append untracked files as synthetic diffs (git diff HEAD omits them).
  for (const path of untracked(cwd).slice(0, 40)) {
    const d = git(cwd, ['diff', '--no-index', '/dev/null', path], { max: 128 * 1024 });
    if (d) diff += d;
    if (diff.length > max) break;
  }
  const truncated = diff.length > max;
  return { isRepo: true, diff: diff.slice(0, max), truncated };
}

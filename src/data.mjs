// Data sources over ~/.claude: live session registry, background jobs,
// project transcripts, tasks. Read-only. Everything degrades gracefully —
// a missing or malformed file yields an empty slice, never a crash.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { sessionSummary, sessionDetail, sessionUsage } from './transcript.mjs';
import { repoState, repoDiff } from './git.mjs';

export const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');

// Flatten a cwd to its ~/.claude/projects dir key (path separators → dashes).
const projectKeyForCwd = (cwd) => (cwd ? cwd.replaceAll('/', '-') : null);

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function listDir(p) {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// --- Live session registry (~/.claude/sessions/<pid>.json) ---
export function liveSessions() {
  const dir = path.join(CLAUDE_DIR, 'sessions');
  const out = [];
  for (const f of listDir(dir)) {
    if (!f.endsWith('.json')) continue;
    const s = readJson(path.join(dir, f));
    if (!s || !s.sessionId) continue;
    if (!pidAlive(s.pid)) continue; // stale registry entry
    out.push({
      pid: s.pid,
      sessionId: s.sessionId,
      cwd: s.cwd,
      name: s.name,
      kind: s.kind,
      jobId: s.jobId,
      status: s.status, // 'busy' | 'idle' | ...
      startedAt: s.startedAt,
      updatedAt: s.updatedAt,
      statusUpdatedAt: s.statusUpdatedAt,
      version: s.version,
    });
  }
  return out;
}

// The live worker (if any) holding a given session — exact sessionId match,
// else cwd fallback (a live worker in this project + this being the newest
// transcript). Decides whether a message would reach a running agent vs fork.
export function liveSessionFor(projectKey, sessionId) {
  const live = liveSessions();
  const exact = live.find((s) => s.sessionId === sessionId);
  if (exact) return exact;
  if (!projectKey) return null;
  const projLive = live.find((s) => projectKeyForCwd(s.cwd) === projectKey);
  if (!projLive) return null;
  const newest = transcriptsIn(projectKey)
    .filter((t) => !t.subagentOf)
    .map((t) => { try { return { id: t.sessionId, m: fs.statSync(t.path).mtimeMs }; } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => b.m - a.m)[0];
  return newest && newest.id === sessionId ? projLive : null;
}

// --- Background jobs (~/.claude/jobs/<id>/state.json) ---
export function jobs() {
  const dir = path.join(CLAUDE_DIR, 'jobs');
  const out = [];
  for (const d of listDir(dir)) {
    const p = path.join(dir, d, 'state.json');
    const s = readJson(p);
    if (!s) continue;
    out.push({
      id: d,
      name: s.name,
      state: s.state,
      tempo: s.tempo,
      detail: s.detail,
      intent: s.intent,
      tokens: s.tokens,
      result: s.output?.result ?? null,
      inFlight: s.inFlight,
      sessionId: s.sessionId,
      cwd: s.cwd,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      cliVersion: s.cliVersion,
    });
  }
  out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return out;
}

export function jobTimeline(id) {
  if (!/^[\w-]+$/.test(id)) return [];
  const p = path.join(CLAUDE_DIR, 'jobs', id, 'timeline.jsonl');
  try {
    return fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// --- Projects & transcripts (~/.claude/projects/<flat-cwd>/<sessionId>.jsonl) ---
export function projectDirs() {
  const dir = path.join(CLAUDE_DIR, 'projects');
  return listDir(dir)
    .filter((d) => {
      try { return fs.statSync(path.join(dir, d)).isDirectory(); } catch { return false; }
    })
    .map((d) => ({ key: d, path: path.join(dir, d) }));
}

const SAFE_KEY = /^[\w.-]+$/;
const isSafeKey = (k) => SAFE_KEY.test(k) && k !== '.' && k !== '..';

// Top-level session transcripts plus their subagent transcripts. Subagent
// turns are billed but live one level down (<sessionId>/subagents/agent-*.jsonl);
// omitting them understates real spend by ~2/3 on agent-heavy work. Their cost
// is attributed to the parent session (usage dedup handles any double-count).
export function transcriptsIn(projectKey) {
  if (!isSafeKey(projectKey)) return [];
  const dir = path.join(CLAUDE_DIR, 'projects', projectKey);
  const out = [];
  for (const f of listDir(dir)) {
    if (f.endsWith('.jsonl')) {
      const sessionId = f.replace(/\.jsonl$/, '');
      out.push({ file: f, sessionId, path: path.join(dir, f), subagentOf: null });
      const subDir = path.join(dir, sessionId, 'subagents');
      for (const sf of listDir(subDir)) {
        if (sf.endsWith('.jsonl')) out.push({ file: sf, sessionId, path: path.join(subDir, sf), subagentOf: sessionId });
      }
    }
  }
  return out;
}

export function transcriptPath(projectKey, sessionId) {
  if (!isSafeKey(projectKey) || !/^[\w-]+$/.test(sessionId)) return null;
  const root = path.join(CLAUDE_DIR, 'projects');
  const p = path.join(root, projectKey, sessionId + '.jsonl');
  // Defense in depth: resolved path must stay inside the projects root.
  if (!path.resolve(p).startsWith(root + path.sep)) return null;
  return fs.existsSync(p) ? p : null;
}

// De-flatten a project dir key into a display name using the transcript cwd
// when available (the flat key is lossy for paths containing '-').
export function projectDisplayName(key, cwd) {
  if (cwd) return cwd.replace(os.homedir(), '~');
  return key.replace(/^-Users-[^-]+-?/, '~/').replaceAll('-', '/');
}

// --- Fleet: the composed view the console lives on ---
// recentDays limits full-parses to recently-touched transcripts; older ones
// appear as stubs (id + mtime) until explicitly opened.
export function fleet({ recentDays = 14 } = {}) {
  const live = liveSessions();
  const liveById = new Map(live.map((s) => [s.sessionId, s]));
  // A live worker's registry sessionId often diverges from the transcript it's
  // actually writing (resume/daemon relabeling — same class as fork id drift).
  // `claude agents` tracks workers by cwd, so we do too: map project → live
  // worker, and treat that project's newest transcript as the live one when an
  // exact sessionId match fails. Without this, freshly-started sessions vanish.
  const liveByProject = new Map();
  for (const s of live) {
    const k = projectKeyForCwd(s.cwd);
    if (k && !liveByProject.has(k)) liveByProject.set(k, s);
  }
  const claimedProjects = new Set(); // projects whose live worker is already exact-matched
  const allJobs = jobs();
  const jobBySession = new Map(allJobs.map((j) => [j.sessionId, j]));
  const cutoff = Date.now() - recentDays * 86400e3;
  const projects = [];

  for (const proj of projectDirs()) {
    const sessions = [];
    let latest = 0;
    let cwd = null;
    // Fold subagent-transcript cost into the parent session's row rather than
    // showing subagents as their own sessions. Parse subagents in firstTs order
    // so requestId ownership is deterministic before any parent claims them.
    const subCost = new Map(); // parent sessionId -> {cost, tokens}
    const entries = transcriptsIn(proj.key);
    for (const t of entries) {
      if (!t.subagentOf) continue;
      const sub = sessionSummary(t.path);
      if (!sub) continue;
      const acc = subCost.get(t.subagentOf) || { cost: 0, tokens: 0 };
      acc.cost += sub.cost;
      acc.tokens += sub.inputTokens + sub.outputTokens;
      subCost.set(t.subagentOf, acc);
    }
    for (const t of entries) {
      if (t.subagentOf) continue; // subagents already folded above
      let st;
      try { st = fs.statSync(t.path); } catch { continue; }
      latest = Math.max(latest, st.mtimeMs);
      if (st.mtimeMs < cutoff || st.size === 0) {
        sessions.push({ sessionId: t.sessionId, stub: true, mtimeMs: st.mtimeMs, sizeBytes: st.size });
        continue;
      }
      const sum = sessionSummary(t.path);
      if (!sum) continue;
      cwd = cwd || sum.cwd;
      const sub = subCost.get(t.sessionId);
      const liveInfo = liveById.get(t.sessionId) || null;
      if (liveInfo) claimedProjects.add(proj.key); // exact match — no cwd fallback needed
      const job = jobBySession.get(t.sessionId) || null;
      sessions.push({
        ...sum,
        cost: sum.cost + (sub?.cost || 0),
        inputTokens: sum.inputTokens + (sub?.tokens || 0),
        subagentCost: sub?.cost || 0,
        projectKey: proj.key,
        live: !!liveInfo,
        liveStatus: liveInfo?.status ?? null,
        pid: liveInfo?.pid ?? null,
        jobId: job?.id ?? liveInfo?.jobId ?? null,
        jobState: job?.state ?? null,
        jobDetail: job?.detail ?? null,
        jobResult: job?.result ?? null,
        status: computeStatus(liveInfo, job, sum),
      });
    }
    sessions.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));

    // cwd fallback: project has a live worker but no transcript matched its id
    // → the newest transcript is what that worker is writing. Mark it live.
    const projLive = liveByProject.get(proj.key);
    if (projLive && !claimedProjects.has(proj.key)) {
      const newest = sessions.find((s) => !s.stub);
      if (newest) {
        cwd = cwd || projLive.cwd;
        const job = jobBySession.get(newest.sessionId) || null;
        Object.assign(newest, {
          live: true,
          liveStatus: projLive.status ?? null,
          pid: projLive.pid ?? null,
          jobId: newest.jobId || projLive.jobId || null,
          status: computeStatus(projLive, job, newest),
        });
      }
    }

    if (!sessions.length) continue;
    projects.push({
      key: proj.key,
      name: projectDisplayName(proj.key, cwd),
      cwd,
      latestMs: latest,
      sessions,
    });
  }
  projects.sort((a, b) => b.latestMs - a.latestMs);
  return { projects, live, jobs: allJobs };
}

// --- Review: the work-product surface (what each agent BUILT) ---
// For every project with an active or recently-finished session, pair the
// agent's own summary with the actual git changes it produced — the thing
// claude agents / iTerm / tmux don't show. One card per project = review
// without cd-ing into every repo.
export function reviewFleet({ recentDays = 3 } = {}) {
  const { projects } = fleet({ recentDays: 14 });
  const cutoff = Date.now() - recentDays * 86400e3;
  const cards = [];
  for (const p of projects) {
    const s = p.sessions.find((x) => !x.stub); // newest real session drives the card
    if (!s) continue;
    // Show a card if the session is live OR was touched recently OR has a report.
    const recent = (s.mtimeMs || 0) >= cutoff;
    if (!s.live && !recent && s.status !== 'done') continue;
    const repo = p.cwd ? repoState(p.cwd) : { isRepo: false };
    cards.push({
      projectKey: p.key,
      name: p.name,
      cwd: p.cwd,
      sessionId: s.sessionId,
      title: s.title,
      status: s.status,
      live: s.live,
      short: s.jobId,
      pid: s.pid,
      lastTs: s.lastTs,
      summary: s.lastAssistantText || s.jobResult || s.jobDetail || null,
      repo,
    });
  }
  // Order: things needing review first — dirty repos & waiting/done, then rest.
  const rank = (c) => (c.status === 'waiting' || c.status === 'stalled' ? 0 : c.repo?.dirty ? 1 : c.status === 'done' ? 2 : 3);
  cards.sort((a, b) => rank(a) - rank(b) || (b.lastTs || '').localeCompare(a.lastTs || ''));
  return cards;
}

export function getDiff(projectKey, sessionId) {
  const p = transcriptPath(projectKey, sessionId);
  if (!p) return null;
  const sum = sessionSummary(p);
  const cwd = sum?.cwd;
  if (!cwd || !fs.existsSync(cwd)) return { isRepo: false, diff: '' };
  return repoDiff(cwd);
}

// Status model:
//  working      — process alive and busy, transcript moving
//  stalled      — process alive and busy but no transcript writes for a while
//                 (possible hang / silent permission prompt) → inbox
//  waiting      — process alive, idle, last transcript entry was assistant
//                 (it said something and is waiting on the user) → inbox
//  idle         — process alive, idle, nothing obviously pending
//  done         — background job finished with a final report → inbox (report ready)
//  ended        — no live process
const STALL_MS = 10 * 60 * 1000;
function computeStatus(liveInfo, job, sum) {
  if (liveInfo) {
    if (liveInfo.status === 'busy') {
      const lastWrite = Math.max(sum.mtimeMs || 0, liveInfo.statusUpdatedAt || 0);
      return Date.now() - lastWrite > STALL_MS ? 'stalled' : 'working';
    }
    if (sum.lastType === 'assistant') return 'waiting';
    return 'idle';
  }
  if (job && job.state === 'done' && job.result) return 'done';
  return 'ended';
}

// --- Inbox: sessions that need the operator's attention ---
export function inbox() {
  const { projects } = fleet({ recentDays: 7 });
  const items = [];
  for (const p of projects) {
    for (const s of p.sessions) {
      if (s.stub) continue;
      const base = {
        project: p.name, projectKey: p.key, sessionId: s.sessionId, title: s.title,
        ts: s.lastTs, live: s.live, short: s.jobId, cwd: s.cwd || p.cwd,
      };
      if (s.status === 'stalled') {
        items.push({ ...base, type: 'stalled', preview: 'Busy but no transcript activity — possible hang or hidden prompt. Check the terminal.' });
      } else if (s.status === 'waiting') {
        items.push({ ...base, type: 'waiting', preview: s.lastAssistantText });
      } else if (s.status === 'done') {
        items.push({ ...base, type: 'report', preview: s.jobResult || s.jobDetail });
      }
    }
  }
  items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  return items;
}

// --- Usage / cost rollup ---
// `month` is 'YYYY-MM' (validated by caller). When set, per-model `cost`/`monthCost`
// are scoped to that month via each model's per-day breakdown, so the CSV's
// per-model rows sum to the month total shown in the UI (no all-time/month mismatch).
export function usageRollup({ month } = {}) {
  const inMonth = (day) => !month || day.startsWith(month);
  const byProject = [];
  for (const proj of projectDirs()) {
    let cwd = null;
    const models = {};
    const byDay = {};
    let sessions = 0;
    for (const t of transcriptsIn(proj.key)) {
      const u = sessionUsage(t.path);
      if (!u) continue;
      cwd = cwd || u.cwd;
      let counted = false;
      for (const [model, v] of Object.entries(u.models)) {
        const m = (models[model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, monthCost: 0, requests: 0 });
        m.input += v.input; m.output += v.output; m.cacheRead += v.cacheRead;
        m.cacheWrite += v.cacheWrite5m + v.cacheWrite1h;
        m.cost += v.cost; m.requests += v.requests;
        // month-scoped per-model cost from the model's daily breakdown
        for (const [day, c] of Object.entries(v.byDay || {})) if (inMonth(day)) m.monthCost += c;
        counted = true;
      }
      for (const [day, c] of Object.entries(u.usageByDay)) {
        if (!inMonth(day)) continue;
        byDay[day] = (byDay[day] || 0) + c;
      }
      if (counted) sessions++;
    }
    const total = Object.values(models).reduce((a, m) => a + m.cost, 0);
    const monthTotal = Object.values(byDay).reduce((a, c) => a + c, 0);
    if (!sessions) continue;
    byProject.push({
      key: proj.key,
      name: projectDisplayName(proj.key, cwd),
      sessions,
      models,
      byDay,
      totalCost: total,
      monthCost: month ? monthTotal : total,
    });
  }
  byProject.sort((a, b) => b.monthCost - a.monthCost);
  return byProject;
}

// --- Full-text search across all transcripts (JTBD: "what did I decide
// about X three weeks ago"). ripgrep with a snippet-extracting pattern so we
// never load multi-MB JSONL lines into memory; falls back to grep -o.
// A real `rg` binary is often absent — Claude Code's own binary embeds
// ripgrep and activates it when argv0 is "rg".
let rgRunner; // {cmd, argv0} | null, resolved once
function resolveRipgrep() {
  if (rgRunner !== undefined) return rgRunner;
  const candidates = [
    { cmd: 'rg', argv0: undefined },
    ...(process.env.CLAUDE_CODE_EXECPATH ? [{ cmd: process.env.CLAUDE_CODE_EXECPATH, argv0: 'rg' }] : []),
    { cmd: path.join(os.homedir(), '.local', 'bin', 'claude'), argv0: 'rg' },
  ];
  for (const c of candidates) {
    const r = spawnSync(c.cmd, ['--version'], { encoding: 'utf8', argv0: c.argv0, timeout: 5000 });
    if (!r.error && (r.stdout || '').startsWith('ripgrep')) {
      rgRunner = c;
      return rgRunner;
    }
  }
  rgRunner = null;
  return rgRunner;
}

export function searchTranscripts(query, { limit = 60 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return { query: q, results: [] };
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = `.{0,90}${escaped}.{0,90}`;
  const root = path.join(CLAUDE_DIR, 'projects');
  let out;
  const rg = resolveRipgrep();
  if (rg) {
    const r = spawnSync(rg.cmd, ['-i', '-o', '--no-heading', '--with-filename', '-m', '4', '-g', '*.jsonl', pattern, root], {
      encoding: 'utf8', argv0: rg.argv0, maxBuffer: 32 * 1024 * 1024, timeout: 15000,
    });
    out = r.stdout || '';
  } else {
    const gr = spawnSync('grep', ['-r', '-i', '-o', '-E', '-m', '4', '--include=*.jsonl', pattern, root], {
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 20000,
    });
    out = gr.stdout || '';
  }

  const bySession = new Map();
  for (const line of out.split('\n')) {
    if (!line) continue;
    const sep = line.indexOf('.jsonl:');
    if (sep === -1) continue;
    const file = line.slice(0, sep + 6);
    let snippet = line.slice(sep + 7);
    // un-escape common JSON string escapes for readability
    snippet = snippet.replace(/\\n/g, ' ').replace(/\\t/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const rel = path.relative(root, file).split(path.sep);
    if (rel.length < 2) continue;
    const projectKey = rel[0];
    // subagent transcripts live under <sessionId>/subagents/…; credit the parent
    const sessionId = rel[1].replace(/\.jsonl$/, '');
    if (!/^[\w-]+$/.test(sessionId)) continue;
    const key = projectKey + '/' + sessionId;
    let rec = bySession.get(key);
    if (!rec) {
      rec = { projectKey, sessionId, file, snippets: [] };
      bySession.set(key, rec);
    }
    if (rec.snippets.length < 4) rec.snippets.push(snippet.slice(0, 220));
  }

  const results = [];
  for (const rec of bySession.values()) {
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(rec.file).mtimeMs; } catch {}
    results.push({ ...rec, file: undefined, mtimeMs });
  }
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const top = results.slice(0, limit);
  // enrich only the returned page with parsed titles (parsing is cached)
  for (const r of top) {
    const p = transcriptPath(r.projectKey, r.sessionId);
    const sum = p ? sessionSummary(p) : null;
    r.title = sum?.title || null;
    r.project = projectDisplayName(r.projectKey, sum?.cwd);
    r.lastTs = sum?.lastTs || null;
  }
  return { query: q, results: top, totalSessions: results.length };
}

export function getSessionDetail(projectKey, sessionId) {
  const p = transcriptPath(projectKey, sessionId);
  if (!p) return null;
  const detail = sessionDetail(p);
  if (!detail) return null;
  const live = liveSessions();
  // Exact sessionId match, else cwd fallback: a live worker in this project +
  // this being the newest transcript = the session that worker is writing
  // (mirrors fleet()'s liveness so a resumed/daemon session offers ATTACH,
  // not a fork). Keeps detail-page liveness consistent with the fleet.
  let liveInfo = live.find((s) => s.sessionId === sessionId) || null;
  if (!liveInfo) {
    const projLive = live.find((s) => projectKeyForCwd(s.cwd) === projectKey);
    if (projLive) {
      const newest = transcriptsIn(projectKey)
        .filter((t) => !t.subagentOf)
        .map((t) => { try { return { id: t.sessionId, m: fs.statSync(t.path).mtimeMs }; } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => b.m - a.m)[0];
      if (newest && newest.id === sessionId) liveInfo = projLive;
    }
  }
  const job = jobs().find((j) => j.sessionId === sessionId) || null;
  return {
    ...detail,
    projectKey,
    live: !!liveInfo,
    liveStatus: liveInfo?.status ?? null,
    pid: liveInfo?.pid ?? null,
    job: job || (liveInfo?.jobId ? { id: liveInfo.jobId } : null),
  };
}

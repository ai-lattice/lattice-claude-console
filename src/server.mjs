// Lattice Claude Console — local server.
// Security posture (v1 requirements from docs/project-understanding.md §0.4):
//   - binds 127.0.0.1 only
//   - bearer token required on every request (cookie set via ?token= once);
//     defends against DNS-rebinding / drive-by localhost requests
//   - read-only over ~/.claude except the explicit "open in terminal" action
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CLAUDE_DIR, fleet, inbox, jobs, jobTimeline, usageRollup, getSessionDetail, searchTranscripts,
} from './data.mjs';
import { transcriptPath } from './data.mjs';
import { sessionSummary } from './transcript.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 4110);
const HOST = '127.0.0.1';

// --- auth token: persisted so bookmarks keep working across restarts ---
const tokenFile = path.join(CLAUDE_DIR, 'console-token');
let TOKEN;
try {
  TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
  if (!TOKEN) throw new Error('empty');
} catch {
  TOKEN = crypto.randomBytes(24).toString('base64url');
  try { fs.writeFileSync(tokenFile, TOKEN, { mode: 0o600 }); } catch {}
}

function authed(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.searchParams.get('token') === TOKEN) return 'query';
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((p) => p.length === 2)
  );
  if (cookies.lcc_token === TOKEN) return 'cookie';
  return null;
}

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(s);
}

// --- SSE change feed driven by fs.watch over ~/.claude ---
const sseClients = new Set();
let pingTimer = null;
function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch { sseClients.delete(res); }
  }
}
let debounce = null;
const pendingKinds = new Set();
function notifyChange(kind) {
  pendingKinds.add(kind);
  // Fire at least once per second while events keep arriving, so a continuously
  // busy session (which never lets the debounce settle) still updates live.
  if (!maxWaitTimer) maxWaitTimer = setTimeout(flushChange, 1000);
  clearTimeout(debounce);
  debounce = setTimeout(flushChange, 400);
}
let maxWaitTimer = null;
function flushChange() {
  clearTimeout(debounce);
  clearTimeout(maxWaitTimer);
  debounce = maxWaitTimer = null;
  if (!pendingKinds.size) return;
  broadcast({ type: 'change', kinds: [...pendingKinds], at: Date.now() });
  pendingKinds.clear();
}
const activeWatchers = new Map(); // sub -> FSWatcher (only successfully-armed dirs)
function armWatcher(sub, kind) {
  if (activeWatchers.has(sub)) return; // already watching — don't stack handles
  const dir = path.join(CLAUDE_DIR, sub);
  try {
    const w = fs.watch(dir, { recursive: true }, () => notifyChange(kind));
    // A watched dir being renamed/removed, or an FSEvents failure, emits 'error'
    // — unhandled it crashes the process. Drop it so the retry loop re-arms.
    w.on('error', () => { activeWatchers.delete(sub); try { w.close(); } catch {} });
    activeWatchers.set(sub, w);
  } catch {
    // dir may not exist yet (e.g. ~/.claude/jobs before the first job) — the
    // interval below retries, so live refresh starts working once it appears.
  }
}
function startWatchers() {
  const feeds = [['projects', 'sessions'], ['sessions', 'live'], ['jobs', 'jobs'], ['tasks', 'tasks']];
  const armAll = () => { for (const [sub, kind] of feeds) armWatcher(sub, kind); };
  armAll();
  const rearm = setInterval(armAll, 30000); // recover dirs absent at boot or whose handle died
  rearm.unref();
  pingTimer = setInterval(() => broadcast({ type: 'ping', at: Date.now() }), 25000);
  pingTimer.unref();
}

// --- actions ---
function openInTerminal(cwd, cb) {
  // Opens the project directory in the user's terminal (iTerm on this machine).
  execFile('open', ['-a', 'iTerm', cwd], (err) => {
    if (err) execFile('open', ['-a', 'Terminal', cwd], cb);
    else cb(null);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const p = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!p.startsWith(PUBLIC_DIR)) return json(res, 404, { error: 'not found' });
  fs.readFile(p, (err, buf) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

const ORIGIN = `http://${HOST}:${PORT}`;
const MONTH_RE = /^\d{4}-\d{2}$/;
const validMonth = (m) => (m && MONTH_RE.test(m) ? m : undefined);

const server = http.createServer(async (req, res) => {
  // Reject spoofed/rebinding hosts up front, and never let a malformed Host
  // header (`new URL` throws on it) crash the process — any local peer could
  // otherwise kill the daemon with one bad request.
  const host = req.headers.host || '';
  const hostOk = host === `${HOST}:${PORT}` || host === HOST || host === `localhost:${PORT}` || host === 'localhost';
  let url;
  try {
    url = new URL(req.url, ORIGIN);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (!hostOk) {
    res.writeHead(403).end('forbidden host');
    return;
  }
  const p = url.pathname;

  const auth = authed(req);
  if (!auth) {
    if (p === '/' || !p.startsWith('/api/')) {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<body style="font-family:system-ui;background:#0d1117;color:#c9d1d9;display:grid;place-items:center;height:100vh;margin:0"><div><h2>Lattice Claude Console</h2><p>Missing token. Launch via the URL printed by <code>npm start</code>.</p></div></body>');
      return;
    }
    return json(res, 401, { error: 'unauthorized' });
  }
  // Promote query-token to cookie so the token drops out of the address bar.
  if (auth === 'query' && !p.startsWith('/api/')) {
    res.setHeader('set-cookie', `lcc_token=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Strict`);
  }

  try {
    if (p === '/api/fleet') return json(res, 200, fleet({ recentDays: Number(url.searchParams.get('days')) || 14 }));
    if (p === '/api/inbox') return json(res, 200, inbox());
    if (p === '/api/jobs') return json(res, 200, jobs());
    if (p.startsWith('/api/job/')) {
      const id = p.split('/')[3];
      return json(res, 200, { timeline: jobTimeline(id) });
    }
    if (p === '/api/search') return json(res, 200, searchTranscripts(url.searchParams.get('q') || ''));
    if (p === '/api/usage') return json(res, 200, usageRollup({ month: validMonth(url.searchParams.get('month')) }));
    if (p === '/api/usage.csv') {
      const month = validMonth(url.searchParams.get('month'));
      const rows = usageRollup({ month });
      // month-scoped per-model cost when a month is set, so rows reconcile to the total
      const costCol = (m) => (month ? m.monthCost : m.cost).toFixed(4);
      let csv = 'project,sessions,model,requests,input_tokens,output_tokens,cache_read,cache_write,cost_usd\n';
      for (const proj of rows) {
        for (const [model, m] of Object.entries(proj.models)) {
          if (month && m.monthCost <= 0) continue;
          csv += [JSON.stringify(proj.name), proj.sessions, model, m.requests, m.input, m.output, m.cacheRead, m.cacheWrite, costCol(m)].join(',') + '\n';
        }
      }
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="claude-usage${month ? '-' + month : ''}.csv"`,
      });
      return res.end(csv);
    }
    if (p.startsWith('/api/session/')) {
      const [, , , projectKey, sessionId] = p.split('/');
      const detail = getSessionDetail(projectKey, sessionId);
      if (!detail) return json(res, 404, { error: 'session not found' });
      return json(res, 200, detail);
    }
    if (p === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'hello', at: Date.now() })}\n\n`);
      sseClients.add(res);
      // A half-dead SSE socket emits 'error' before 'close'; without this listener
      // that surfaces as an unhandled 'error' event → process exit.
      res.on('error', () => sseClients.delete(res));
      req.on('close', () => sseClients.delete(res));
      return;
    }
    // State-changing endpoints: enforce same-origin + JSON to close CSRF. The
    // token cookie is port-blind (any 127.0.0.1:* page is "same-site"), so
    // SameSite=Strict alone is not enough — require our exact Origin.
    if ((p === '/api/send' || p === '/api/open-terminal') && req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== ORIGIN) return json(res, 403, { error: 'bad origin' });
      if (!/^application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'json required' });
    }
    if (p === '/api/send' && req.method === 'POST') {
      const body = await readBody(req);
      const { projectKey, sessionId } = body;
      const message = String(body.message || '').trim();
      if (!message) return json(res, 400, { error: 'empty message' });
      if (message.length > 20000) return json(res, 400, { error: 'message too long' });
      if (/^-/.test(String(sessionId || ''))) return json(res, 400, { error: 'invalid session id' });
      const tp = transcriptPath(String(projectKey || ''), String(sessionId || ''));
      if (!tp) return json(res, 404, { error: 'session not found' });
      const sum = sessionSummary(tp);
      const cwd = sum?.cwd && fs.existsSync(sum.cwd) ? sum.cwd : process.env.HOME;
      // Dispatch a background continuation of the session via the Claude Code
      // daemon. args-array spawn → never shell-interpreted; the `--` argv
      // terminator ensures a message starting with "-" can't smuggle a flag.
      const child = spawn('claude', ['--bg', '--resume', sessionId, '--', message], {
        cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '', errOut = '', settled = false;
      const finish = (code) => {
        if (settled) return;
        settled = true;
        if (code === 0) {
          // "backgrounded · <short>" — strip ANSI color codes before matching
          const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
          const short = clean.match(/backgrounded\s*·\s*([0-9a-f]{8})/)?.[1] || null;
          json(res, 200, { ok: true, short, output: clean.trim().slice(0, 400) });
        } else json(res, 500, { error: (errOut || out || 'dispatch failed').trim().slice(0, 400) });
      };
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (errOut += d));
      child.on('exit', finish);
      child.on('error', () => finish(1));
      // --bg returns quickly; guard with a timeout so the request can't hang
      setTimeout(() => {
        if (!settled) { settled = true; child.unref(); json(res, 200, { ok: true, output: 'dispatched (still starting)' }); }
      }, 15000);
      return;
    }
    if (p === '/api/open-terminal' && req.method === 'POST') {
      const body = await readBody(req);
      const cwd = String(body.cwd || '');
      if (!cwd.startsWith('/') || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        return json(res, 400, { error: 'invalid directory' });
      }
      return openInTerminal(cwd, (err) => {
        if (err) return json(res, 500, { error: 'could not open terminal' });
        json(res, 200, { ok: true });
      });
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    return serveStatic(res, p);
  } catch (err) {
    return json(res, 500, { error: String(err?.message || err) });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use — is the console already running?`);
    console.error(`  Open it at: ${ORIGIN}/?token=${TOKEN}`);
    console.error(`  Or start on another port:  PORT=4111 npm start\n`);
  } else {
    console.error('  Server error:', err.message);
  }
  process.exit(1);
});

// A background watcher/timer throwing must not take the daemon down silently.
process.on('uncaughtException', (err) => console.error('  uncaught:', err?.stack || err));
process.on('unhandledRejection', (err) => console.error('  unhandled rejection:', err?.stack || err));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const res of sseClients) { try { res.end(); } catch {} }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}

server.listen(PORT, HOST, () => {
  startWatchers();
  const url = `${ORIGIN}/?token=${TOKEN}`;
  console.log('\n  Lattice Claude Console');
  console.log(`  ${url}\n`);
  if (process.env.LCC_OPEN !== '0') execFile('open', [url], () => {});
});

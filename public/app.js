/* Lattice Claude Console — vanilla SPA */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const main = $('#main');

// ---------- utilities ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ago(ts) {
  if (!ts) return '—';
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm ago';
  const d = Math.floor(h / 24);
  return d + 'd ago';
}

const fmtTok = (n) => {
  if (!Number.isFinite(n)) return '—'; // never fall through to raw String() (HTML-injection guard)
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
};
const fmtUsd = (n) => (n == null ? '—' : '$' + (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3)));
const shortId = (id) => (id || '').slice(0, 8);
const modelShort = (m) => (m || '').replace(/^claude-/, '').replace(/-\d{8}$/, '');

// escape-then-format: fenced code, inline code, bold; keeps it safe and light
function md(text) {
  let h = esc(text);
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code}</code></pre>`);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  h = h.replace(/^### (.*)$/gm, '<b>$1</b>');
  h = h.replace(/^## (.*)$/gm, '<b>$1</b>');
  h = h.replace(/\n/g, '<br>');
  h = h.replace(/(<pre><code>[\s\S]*?<\/code><\/pre>)/g, (m) => m.replace(/<br>/g, '\n'));
  return h;
}

async function api(path) {
  const r = await fetch(path, { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

function copy(text, label) {
  navigator.clipboard.writeText(text).then(() => toast(label || 'COPIED'));
}

async function openTerminal(cwd) {
  try {
    const r = await fetch('/api/open-terminal', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd }),
    });
    if (!r.ok) throw new Error();
    toast('OPENING TERMINAL');
  } catch {
    toast('FAILED TO OPEN');
  }
}
// Delegated actions — no inline JS with interpolated strings (XSS-safe:
// values live in data-attributes and never re-enter a JS parsing context).
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-act]');
  if (btn) {
    ev.preventDefault();
    ev.stopPropagation();
    runAct(btn.dataset.act, btn.dataset);
    return;
  }
  // Clicking anywhere on a nav-row (outside its buttons) opens it.
  const row = ev.target.closest('.nav-row');
  if (row && row.dataset.open) { selectRow(row); location.hash = row.dataset.open; }
});

function runAct(act, d) {
  if (act === 'term' && d.cwd) openTerminal(d.cwd);
  else if (act === 'copy' && d.copyText != null) copy(d.copyText, d.copyLabel);
  else if (act === 'attach') attachSession(d.short);
  else if (act === 'open' && d.open) location.hash = d.open;
  else if (act === 'toggle-ended') {
    if (expandedEnded.has(d.key)) expandedEnded.delete(d.key);
    else expandedEnded.add(d.key);
    if (currentRender) currentRender();
  }
  else if (act === 'dismiss' && d.rkey) dismissReport(d.rkey);
  else if (act === 'diff' && d.dkey) toggleDiff(d.dkey);
}

const chip = (status) => `<span class="chip ${esc(status)}">${esc(status)}</span>`;

// Inline action buttons available on a session/inbox row. Live sessions get
// ATTACH (talk to the running worker); every row gets OPEN and, if it has a
// cwd, a terminal shortcut. Keeps mouse parity with the keyboard shortcuts.
function rowActions({ open, live, short, cwd }) {
  const btns = [];
  if (live && short) btns.push(`<button class="btn mini amber" data-act="attach" data-short="${esc(short)}" title="attach (a)">ATTACH</button>`);
  btns.push(`<button class="btn mini" data-act="open" data-open="${esc(open)}" title="open (↵)">OPEN</button>`);
  if (cwd) btns.push(`<button class="btn mini" data-act="term" data-cwd="${esc(cwd)}" title="terminal (t)">⇱</button>`);
  return `<span class="row-actions">${btns.join('')}</span>`;
}

// "Waiting on you" = genuinely blocked on your input (waiting/stalled).
// Reports are FINISHED work to review, not something awaiting a reply — kept
// separate so the attention count matches `claude agents` ("N awaiting input").
const needsInput = (items) => items.filter((i) => i.type === 'waiting' || i.type === 'stalled');

// Dismissed (acknowledged) reports — persisted per-browser so a report you've
// reviewed stays gone. Keyed by sessionId + ts so a *new* report on the same
// session (a later run) re-surfaces rather than staying hidden.
function loadDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem('lcc_dismissed') || '[]')); } catch { return new Set(); }
}
let dismissed = loadDismissed();
const reportKey = (i) => `${i.sessionId}@${i.ts || ''}`;
function dismissReport(key) {
  dismissed.add(key);
  try { localStorage.setItem('lcc_dismissed', JSON.stringify([...dismissed].slice(-500))); } catch {}
  if (currentRender) currentRender();
}
const finished = (items) => items.filter((i) => i.type === 'report' && !dismissed.has(reportKey(i)));

// ---------- REVIEW: the work-product surface (the point of this tool) ----------
// One card per project: what the agent CHANGED (git diff/stat/commits) paired
// with what it SAYS it did (its summary). Review the work without cd-ing into
// every repo — the job claude agents / iTerm / tmux don't do.
const diffCache = new Map(); // key -> {open, html}

async function viewReview() {
  const cards = await api('/api/review?days=3');
  setBadge(cards.filter((c) => c.status === 'waiting' || c.status === 'stalled').length);
  $('#foot-stats').textContent = `${cards.length} to review`;

  let html = `<h1 class="view-title"><span class="accent">01</span> REVIEW — WHAT YOUR AGENTS BUILT</h1>`;
  if (!cards.length) {
    html += `<div class="panel"><div class="empty">No active or recent work to review. Launch agents, then check back.</div></div>`;
    main.innerHTML = html;
    return;
  }
  html += cards.map(reviewCardHtml).join('');
  main.innerHTML = html;
  initNav();
  // restore any expanded diffs
  for (const [key, st] of diffCache) if (st.open) renderDiffInto(key);
}

function diffKey(c) { return `${c.projectKey}/${c.sessionId}`; }

function reviewCardHtml(c) {
  const open = `#/session/${esc(c.projectKey)}/${esc(c.sessionId)}`;
  const r = c.repo || {};
  const stat = r.isRepo
    ? (r.dirty
        ? `<span class="ds"><b>${r.diffstat.files}</b> file${r.diffstat.files !== 1 ? 's' : ''}</span> <span class="add">+${r.diffstat.insertions}</span> <span class="del">−${r.diffstat.deletions}</span>${r.aheadCount ? ` · <span class="ahead">${r.aheadCount} unpushed</span>` : ''}`
        : (r.aheadCount ? `<span class="ahead">${r.aheadCount} unpushed commit${r.aheadCount !== 1 ? 's' : ''}</span>` : '<span class="clean">working tree clean</span>'))
    : '<span class="muted">not a git repo</span>';

  const files = r.isRepo && r.files?.length
    ? `<div class="filelist">${r.files.map((f) => `<div class="fl-row">
        <span class="fl-path">${esc(f.path)}${f.untracked ? ' <span class="fl-new">new</span>' : ''}</span>
        ${f.added != null ? `<span class="add">+${f.added}</span> <span class="del">−${f.removed}</span>` : '<span class="muted">bin</span>'}
      </div>`).join('')}${r.filesTruncated ? `<div class="fl-row muted">+${r.filesTruncated} more…</div>` : ''}</div>`
    : '';

  const commits = r.isRepo && r.commits?.length
    ? `<div class="commits">${r.commits.slice(0, 4).map((cm) => `<div class="cm-row ${cm.byClaude ? 'by-claude' : ''}">
        <span class="cm-hash">${esc(cm.hash)}</span>
        <span class="cm-subj">${esc(cm.subject)}</span>
        <span class="cm-when">${esc(cm.when)}</span>
      </div>`).join('')}</div>`
    : '';

  const canDiff = r.isRepo && (r.dirty);
  const acts = rowActions({ open, live: c.live, short: c.short, cwd: c.cwd });

  return `<div class="panel review-card nav-row" tabindex="-1"
      data-open="${open}" data-live="${c.live ? '1' : ''}" data-short="${esc(c.short || '')}" data-cwd="${esc(c.cwd || '')}"
      data-dkey="${esc(diffKey(c))}">
    <div class="rc-head">
      ${chip(c.status)}
      <span class="rc-title">${esc(c.title || shortId(c.sessionId))}</span>
      <span class="muted rc-proj">${esc(c.name)}</span>
      ${r.branch ? `<span class="kv branch-tag">⎇ ${esc(r.branch)}</span>` : ''}
      <span class="rc-stat">${stat}</span>
      <span class="ago">${ago(c.lastTs)}</span>
      ${acts}
    </div>
    ${c.summary ? `<div class="rc-summary">${md((c.summary || '').slice(0, 800))}</div>` : ''}
    ${files}
    ${commits}
    ${canDiff ? `<div class="rc-diffbar"><button class="btn mini" data-act="diff" data-dkey="${esc(diffKey(c))}">${
      diffCache.get(diffKey(c))?.open ? '▾ HIDE DIFF' : '▸ SHOW DIFF'
    }</button></div><div class="diff-slot" id="diff-${esc(diffKey(c).replace(/[^\w]/g, '_'))}"></div>` : ''}
  </div>`;
}

async function toggleDiff(key) {
  const st = diffCache.get(key) || { open: false, html: null };
  st.open = !st.open;
  diffCache.set(key, st);
  // Update the button label in place, then fill/clear the slot — no full re-render.
  const btn = document.querySelector(`[data-act="diff"][data-dkey="${cssEsc(key)}"]`);
  if (btn) btn.textContent = st.open ? '▾ HIDE DIFF' : '▸ SHOW DIFF';
  if (st.open) await renderDiffInto(key);
  else { const slot = document.getElementById('diff-' + key.replace(/[^\w]/g, '_')); if (slot) slot.innerHTML = ''; }
}
// escape a value for use inside a CSS attribute selector
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

async function renderDiffInto(key) {
  const slot = document.getElementById('diff-' + key.replace(/[^\w]/g, '_'));
  if (!slot) return;
  const st = diffCache.get(key);
  if (!st?.open) { slot.innerHTML = ''; return; }
  if (st.html) { slot.innerHTML = st.html; return; }
  slot.innerHTML = '<div class="diff-loading muted">loading diff…</div>';
  const [projectKey, sessionId] = key.split('/');
  try {
    const d = await api(`/api/diff?projectKey=${encodeURIComponent(projectKey)}&sessionId=${encodeURIComponent(sessionId)}`);
    st.html = renderUnifiedDiff(d.diff || '', d.truncated);
    slot.innerHTML = st.html;
  } catch {
    slot.innerHTML = '<div class="diff-loading muted">could not load diff</div>';
  }
}

// Color a unified diff. Escaped first; then per-line class by leading char.
function renderUnifiedDiff(diff, truncated) {
  if (!diff.trim()) return '<div class="diff-loading muted">no textual changes</div>';
  const lines = diff.split('\n').map((ln) => {
    const c = ln[0];
    let cls = 'd-ctx';
    if (ln.startsWith('diff --git') || ln.startsWith('index ') || ln.startsWith('--- ') || ln.startsWith('+++ ')) cls = 'd-file';
    else if (ln.startsWith('@@')) cls = 'd-hunk';
    else if (c === '+') cls = 'd-add';
    else if (c === '-') cls = 'd-del';
    return `<div class="${cls}">${esc(ln) || '&nbsp;'}</div>`;
  });
  return `<pre class="diff">${lines.join('')}</pre>${truncated ? '<div class="muted" style="padding:4px 10px">diff truncated — open the session or terminal for the full change</div>' : ''}`;
}

// ---------- views ----------
async function viewFleet() {
  const [data, inboxItems] = await Promise.all([api('/api/fleet?days=14'), api('/api/inbox')]);
  const waiting = needsInput(inboxItems);
  const done = finished(inboxItems);
  setBadge(waiting.length);
  footStats(data);

  let html = `<h1 class="view-title"><span class="accent">01</span> FLEET</h1>`;

  if (waiting.length) {
    html += `<div class="panel inbox-strip">
      <div class="panel-head">▲ WAITING ON YOU <span class="meta">${waiting.length} awaiting input</span></div>
      ${waiting.slice(0, 6).map(inboxItemHtml).join('')}
    </div>`;
  }
  // Finished reports are NOT duplicated here — the done session already shows
  // in its project row below with a DONE chip. Review + dismiss lives in Inbox.

  // Only show projects with something active or a pending report by default —
  // a work console surfaces live/actionable work, not historical sessions.
  const projectsToShow = data.projects.filter((p) => {
    const active = p.sessions.some((s) => !s.stub && (s.live || s.status === 'done'));
    return active || expandedEnded.has(p.key);
  });

  for (const p of projectsToShow) {
    const liveCount = p.sessions.filter((s) => s.live).length;
    // Active = live workers or a finished report. Everything else (ended,
    // stubs) is history — collapsed behind a toggle so it isn't wall-of-noise.
    const active = p.sessions.filter((s) => !s.stub && (s.live || s.status === 'done'));
    const hidden = p.sessions.filter((s) => s.stub || (!s.live && s.status !== 'done'));
    const isExp = expandedEnded.has(p.key);
    html += `<div class="panel">
      <div class="panel-head">
        <span class="proj-head-row"><span class="proj-name">${esc(p.name)}</span></span>
        <span class="meta">${liveCount ? liveCount + ' live · ' : ''}${active.length} active${
          p.cwd ? ` · <a href="#" data-act="term" data-cwd="${esc(p.cwd)}">open ⇱</a>` : ''
        }</span>
      </div>
      ${active.map((s) => sessRowHtml(p, s)).join('') || '<div class="stub-row">No active sessions.</div>'}
      ${isExp ? hidden.filter((s) => !s.stub).map((s) => sessRowHtml(p, s)).join('') : ''}
      ${hidden.length ? `<div class="stub-row toggle-ended" data-act="toggle-ended" data-key="${esc(p.key)}">${
        isExp ? '▾ hide' : `▸ ${hidden.length} ended/older session${hidden.length > 1 ? 's' : ''}`
      }</div>` : ''}
    </div>`;
  }

  const hiddenProjects = data.projects.length - projectsToShow.length;
  if (hiddenProjects > 0) {
    html += `<div class="stub-row" style="padding:10px 14px">${hiddenProjects} project${hiddenProjects > 1 ? 's' : ''} with only ended sessions — find them in Search.</div>`;
  }
  if (!data.projects.length) html += `<div class="panel"><div class="empty">No Claude Code sessions found under ~/.claude/projects</div></div>`;
  main.innerHTML = html;
  initNav();
}

// Projects whose ended sessions the user chose to expand (survives re-render).
const expandedEnded = new Set();

function inboxItemHtml(it) {
  const open = `#/session/${esc(it.projectKey)}/${esc(it.sessionId)}`;
  const acts = rowActions({ open, live: it.live, short: it.short, cwd: it.cwd });
  // Finished reports get a dismiss (acknowledge) button.
  const dismiss = it.type === 'report'
    ? `<button class="btn mini dismiss" data-act="dismiss" data-rkey="${esc(reportKey(it))}" title="dismiss (x)">✕</button>` : '';
  return `<div class="inbox-item nav-row" tabindex="-1"
      data-open="${open}" data-live="${it.live ? '1' : ''}" data-short="${esc(it.short || '')}" data-cwd="${esc(it.cwd || '')}"
      data-rkey="${it.type === 'report' ? esc(reportKey(it)) : ''}">
    <div class="line1">
      ${chip(it.type === 'waiting' ? 'waiting' : it.type === 'stalled' ? 'stalled' : 'report')}
      <b>${esc(it.title || shortId(it.sessionId))}</b>
      <span class="muted">${esc(it.project)}</span>
      <span class="ago" style="margin-left:auto">${ago(it.ts)}</span>
      ${acts}${dismiss}
    </div>
    <div class="preview">${esc((it.preview || '').replace(/\s+/g, ' ').slice(0, 220))}</div>
  </div>`;
}

function sessRowHtml(p, s) {
  const open = `#/session/${esc(p.key)}/${esc(s.sessionId)}`;
  const acts = rowActions({ open, live: s.live, short: s.jobId, cwd: s.cwd || p.cwd });
  return `<div class="sess-row nav-row" tabindex="-1"
      data-open="${open}" data-live="${s.live ? '1' : ''}" data-short="${esc(s.jobId || '')}" data-cwd="${esc(s.cwd || p.cwd || '')}">
    <span>${chip(s.status)}</span>
    <span class="sess-title">
      <span class="t">${esc(s.title || shortId(s.sessionId))}</span>
      <span class="p">${esc((s.lastAssistantText || s.lastUserText || '').replace(/\s+/g, ' ').slice(0, 140))}</span>
    </span>
    <span class="ago">${ago(s.lastTs)}</span>
    ${acts}
  </div>`;
}

async function viewInbox() {
  const items = await api('/api/inbox');
  const waiting = needsInput(items);
  const done = finished(items);
  setBadge(waiting.length);
  let html = `<h1 class="view-title"><span class="accent">02</span> INBOX</h1>`;
  html += `<div class="panel inbox-strip">
    <div class="panel-head">▲ WAITING ON YOU <span class="meta">${waiting.length} awaiting input</span></div>
    ${waiting.length ? waiting.map(inboxItemHtml).join('') : `<div class="empty">Nothing is blocked on you. The fleet is running.</div>`}
  </div>`;
  if (done.length) {
    html += `<div class="panel finished-strip">
      <div class="panel-head">✓ FINISHED — REVIEW <span class="meta">${done.length} report${done.length > 1 ? 's' : ''}</span></div>
      ${done.map(inboxItemHtml).join('')}
    </div>`;
  }
  main.innerHTML = html;
  initNav();
}

async function viewJobs() {
  const jobsList = await api('/api/jobs');
  let html = `<h1 class="view-title"><span class="accent">03</span> BACKGROUND JOBS</h1>`;
  if (!jobsList.length) html += `<div class="panel"><div class="empty">No background jobs.</div></div>`;
  const timelines = await Promise.all(
    jobsList.map((j) => api(`/api/job/${j.id}`).then((r) => r.timeline).catch(() => []))
  );
  for (const [i, j] of jobsList.entries()) {
    const tl = timelines[i] || [];
    html += `<div class="panel">
      <div class="panel-head">
        <span class="proj-head-row">
          ${chip(j.state === 'done' ? 'done' : j.tempo === 'idle' ? 'idle' : 'working')}
          <span class="proj-name">${esc(j.name || j.id)}</span>
        </span>
        <span class="meta">${esc(j.id)} · ${fmtTok(j.tokens)} tok · ${ago(j.updatedAt)}</span>
      </div>
      <div style="padding:10px 14px">
        <div class="job-detail-text">${esc(j.detail || '')}</div>
        ${j.intent ? `<div class="job-detail-text muted" style="margin-top:4px">intent: ${esc(j.intent.slice(0, 200))}</div>` : ''}
        <div class="btn-row" style="margin-top:10px">
          ${j.sessionId && j.cwd ? `<a class="btn" href="#/session/${esc(j.cwd.replaceAll('/', '-'))}/${esc(j.sessionId)}">TRANSCRIPT</a>` : ''}
          <button class="btn" data-act="copy" data-copy-text="claude --resume ${esc(j.sessionId)}" data-copy-label="RESUME CMD COPIED">COPY RESUME</button>
          ${j.cwd ? `<button class="btn amber" data-act="term" data-cwd="${esc(j.cwd)}">OPEN DIR</button>` : ''}
        </div>
      </div>
      ${j.result ? `<div class="result-block">${esc(j.result)}</div>` : ''}
      ${tl.length ? `<details class="job-history"><summary>RUN HISTORY · ${tl.length} checkpoint${tl.length > 1 ? 's' : ''}</summary>
        ${tl.slice(-12).map((t) => `<div class="hist-row">
          <span class="hist-ts">${esc((t.at || '').replace('T', ' ').slice(0, 19))}</span>
          <span class="hist-state">${esc(t.state || '')}</span>
          <span class="hist-detail">${esc((t.detail || '').slice(0, 160))}</span>
        </div>`).join('')}
      </details>` : ''}
    </div>`;
  }
  main.innerHTML = html;
}

async function viewSearch() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const q = params.get('q') || '';
  let html = `<h1 class="view-title"><span class="accent">05</span> SEARCH TRANSCRIPTS</h1>
  <form id="search-form" class="toolbar">
    <input id="search-input" type="search" placeholder="what did I decide about…" value="${esc(q)}" style="flex:1;max-width:520px" autofocus />
    <button class="btn" type="submit">SEARCH ▸</button>
  </form>
  <div id="search-results"></div>`;
  main.innerHTML = html;
  const form = $('#search-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#search-input').value.trim();
    location.hash = '#/search?q=' + encodeURIComponent(v);
  });
  if (q.trim().length >= 2) {
    $('#search-results').innerHTML = '<div class="panel"><div class="empty">Searching…</div></div>';
    try {
      const data = await api('/api/search?q=' + encodeURIComponent(q));
      const rs = data.results || [];
      $('#search-results').innerHTML = `<div class="panel">
        <div class="panel-head">RESULTS <span class="meta">${data.totalSessions ?? rs.length} session${rs.length !== 1 ? 's' : ''} matched</span></div>
        ${rs.length ? rs.map((r) => `<a class="inbox-item" href="#/session/${esc(r.projectKey)}/${esc(r.sessionId)}">
          <div class="line1"><b>${esc(r.title || shortId(r.sessionId))}</b>
            <span class="muted">${esc(r.project || r.projectKey)}</span>
            <span class="ago" style="margin-left:auto">${ago(r.lastTs)}</span></div>
          ${r.snippets.map((s) => `<div class="preview">…${esc(s)}…</div>`).join('')}
        </a>`).join('') : '<div class="empty">No matches.</div>'}
      </div>`;
    } catch (err) {
      $('#search-results').innerHTML = `<div class="panel"><div class="empty">Search failed: ${esc(err.message)}</div></div>`;
    }
  }
}

const localMonth = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

async function viewUsage() {
  const now = new Date();
  const thisMonth = localMonth(now); // local, matches server-side local-day bucketing
  const raw = new URLSearchParams(location.hash.split('?')[1] || '').get('month');
  // Validate strictly — month flows into HTML and a fetch URL; only YYYY-MM allowed.
  const month = raw === null ? thisMonth : /^\d{4}-\d{2}$/.test(raw) ? raw : '';
  const rows = await api('/api/usage' + (month ? `?month=${encodeURIComponent(month)}` : ''));

  const months = [];
  for (let i = 0; i < 6; i++) months.push(localMonth(new Date(now.getFullYear(), now.getMonth() - i, 1)));

  // Provable numbers only — request + token counts straight from the usage
  // records. No dollar cost: on a subscription a list-price figure is wrong
  // and misleading, so it's not shown.
  const agg = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const modelAgg = {};
  for (const r of rows)
    for (const [m, v] of Object.entries(r.models)) {
      const t = (modelAgg[m] ??= { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      for (const k of Object.keys(agg)) { t[k] += v[k] || 0; agg[k] += v[k] || 0; }
    }

  let html = `<h1 class="view-title"><span class="accent">05</span> USAGE</h1>
  <div class="toolbar">
    <select id="month-sel">
      <option value="">All time</option>
      ${months.map((m) => `<option value="${esc(m)}" ${m === month ? 'selected' : ''}>${esc(m)}</option>`).join('')}
    </select>
    <a class="btn" href="/api/usage.csv${month ? `?month=${encodeURIComponent(month)}` : ''}" download>EXPORT CSV${month ? ' · ' + esc(month) : ''}</a>
  </div>`;

  // Headline: provable token counts, each category separate (no misleading sum).
  html += `<div class="stat-row">
    ${stat('REQUESTS', fmtTok(agg.requests))}
    ${stat('INPUT (new)', fmtTok(agg.input), 'fresh prompt tokens')}
    ${stat('OUTPUT', fmtTok(agg.output), 'generated tokens')}
    ${stat('CACHE READ', fmtTok(agg.cacheRead), 'reused context — not new work')}
    ${stat('CACHE WRITE', fmtTok(agg.cacheWrite), 'context written to cache')}
  </div>`;

  html += `<div class="panel"><div class="panel-head">BY MODEL
    <span class="meta">${month ? esc(month) : 'all time'} · exact token counts from session records</span></div>
  <table class="data">
    <tr><th>MODEL</th><th class="r">REQUESTS</th><th class="r">INPUT</th><th class="r">OUTPUT</th><th class="r">CACHE READ</th><th class="r">CACHE WRITE</th></tr>
    ${Object.entries(modelAgg)
      .sort((a, b) => b[1].requests - a[1].requests)
      .map(([m, v]) => `<tr>
        <td>${esc(modelShort(m))}</td><td class="r">${fmtTok(v.requests)}</td>
        <td class="r">${fmtTok(v.input)}</td><td class="r">${fmtTok(v.output)}</td>
        <td class="r">${fmtTok(v.cacheRead)}</td><td class="r">${fmtTok(v.cacheWrite)}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty">No usage recorded.</td></tr>'}
  </table></div>`;

  main.innerHTML = html;
  $('#month-sel')?.addEventListener('change', (e) => {
    location.hash = '#/usage' + (e.target.value ? `?month=${e.target.value}` : '?month=');
  });
}

function stat(label, value, hint) {
  return `<div class="stat"><div class="stat-v">${esc(value)}</div><div class="stat-k">${esc(label)}</div>${
    hint ? `<div class="stat-h">${esc(hint)}</div>` : ''
  }</div>`;
}


async function viewSession(projectKey, sessionId) {
  const d = await api(`/api/session/${projectKey}/${sessionId}`);
  const status = d.live ? (d.liveStatus === 'busy' ? 'working' : d.lastType === 'assistant' ? 'waiting' : 'idle') : d.job?.state === 'done' ? 'done' : 'ended';

  let html = `<h1 class="view-title"><span class="accent">⌁</span> SESSION</h1>
  <div class="panel">
    <div class="detail-head">
      ${chip(status)}
      <h2>${esc(d.title || shortId(d.sessionId))}</h2>
      <span class="kv">dir <b>${esc(d.cwd || '—')}</b></span>
      ${d.gitBranch ? `<span class="kv">branch <b>${esc(d.gitBranch)}</b></span>` : ''}
      <span class="kv">turns <b>${d.turns}</b></span>
      <span class="kv">last <b>${ago(d.lastTs)}</b></span>
      ${d.pid ? `<span class="kv">pid <b>${d.pid}</b></span>` : ''}
    </div>
    <div class="btn-row" style="padding:0 14px 12px">
      <button class="btn" data-act="copy" data-copy-text="claude --resume ${esc(d.sessionId)}" data-copy-label="RESUME CMD COPIED">COPY RESUME CMD</button>
      ${d.cwd ? `<button class="btn amber" data-act="term" data-cwd="${esc(d.cwd)}">OPEN IN TERMINAL</button>` : ''}
      <button class="btn" data-act="copy" data-copy-text="${esc(d.sessionId)}" data-copy-label="SESSION ID COPIED">COPY ID</button>
    </div>
    ${d.job?.result ? `<div class="result-block">${esc(d.job.result)}</div>` : ''}
  </div>`;

  const entries = d.entries || [];
  html += `<div class="panel"><div class="panel-head">TRANSCRIPT
    <span class="meta">${entries.length}${d.entryCount > entries.length ? ` of ${d.entryCount}` : ''} events · newest last</span></div>
    <div class="timeline">
    ${entries.map(entryHtml).join('') || '<div class="empty">No conversation yet.</div>'}
    </div></div>`;

  // composer — behavior depends on whether the session is live.
  // A LIVE session is held by a running worker; sending would fork a second
  // one, so we attach to the real worker in a terminal instead. Only an ENDED
  // session is safe to continue from here (a genuine continuation, not a fork).
  if (d.live) {
    html += `<div class="composer panel live-attach">
      <div class="attach-note">
        <span class="chip ${esc(status)}">${esc(status)}</span>
        This session is <b>live</b> — a worker (pid ${d.pid ?? '—'}) is holding it.
        Sending from here would fork a <em>second</em> session onto the same thread.
        Reply to the running agent directly instead:
      </div>
      <div class="composer-foot">
        <span class="muted">opens a terminal running <code>claude attach ${esc(d.job?.id || '')}</code></span>
        <button class="btn amber" data-act="attach" data-short="${esc(d.job?.id || '')}">ATTACH IN TERMINAL ▸</button>
      </div>
    </div>`;
  } else {
    html += `<div class="composer panel">
      <form id="composer-form">
        <textarea id="composer-input" rows="2" placeholder="Continue this ended session…" spellcheck="false"></textarea>
        <div class="composer-foot">
          <span class="muted">continues via <code>claude --bg --resume</code> — the console follows the continuation automatically</span>
          <button class="btn amber" type="submit">SEND ▸</button>
        </div>
      </form>
    </div>`;
  }

  main.innerHTML = html;
  main.scrollTop = main.scrollHeight;
  wireComposer(projectKey, sessionId);
}

async function attachSession(short) {
  if (!short) { toast('NO LIVE REF'); return; }
  toast('OPENING TERMINAL…');
  try {
    const r = await fetch('/api/attach', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ short }),
    });
    if (!r.ok) throw new Error();
    toast('ATTACHED — REPLY IN TERMINAL');
  } catch { toast('COULD NOT ATTACH'); }
}

function wireComposer(projectKey, sessionId) {
  const form = $('#composer-form');
  const input = $('#composer-input');
  if (!form || !input) return; // live sessions render an attach panel, no form
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.disabled = true;
    toast('DISPATCHING…');
    try {
      const r = await fetch('/api/send', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectKey, sessionId, message }),
      });
      const body = await r.json();
      // Session went live between render and send → attach instead of forking.
      if (r.status === 409 && body.live) {
        toast('SESSION IS LIVE — ATTACHING');
        attachSession(body.short);
        return;
      }
      if (!r.ok) throw new Error(body.error || 'send failed');
      input.value = '';
      toast('SENT — FOLLOWING SESSION');
      if (body.short) followDispatch(projectKey, body.short);
    } catch (err) {
      toast('SEND FAILED: ' + err.message.slice(0, 60));
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
}

// ---------- keyboard navigation across rows ----------
// Any view that renders `.nav-row` elements calls initNav() after paint.
// One selection cursor moves with ↑/↓ or j/k; shortcuts act on the selected
// row (↵ open, a attach, t terminal, r reply). Mouse users get the same via
// the inline row-action buttons — full keyboard/mouse parity.
let navRows = [];
let navIdx = -1;
function initNav() {
  navRows = [...main.querySelectorAll('.nav-row')];
  navIdx = navRows.length ? 0 : -1;
  paintNav();
}
function paintNav() {
  navRows.forEach((r, i) => r.classList.toggle('selected', i === navIdx));
}
function selectRow(row) {
  const i = navRows.indexOf(row);
  if (i >= 0) { navIdx = i; paintNav(); }
}
function moveNav(delta) {
  if (!navRows.length) return;
  navIdx = (navIdx + delta + navRows.length) % navRows.length;
  paintNav();
  navRows[navIdx].scrollIntoView({ block: 'nearest' });
}
function selectedRow() {
  return navIdx >= 0 ? navRows[navIdx] : null;
}

document.addEventListener('keydown', (e) => {
  // Never hijack typing in the composer/search box.
  const a = document.activeElement;
  if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) {
    if (e.key === 'Escape') a.blur();
    return;
  }
  // Escape / Backspace → back out to Fleet (keyboard escape route from any view).
  if (e.key === 'Escape' || (e.key === 'Backspace' && !/^#\/?$/.test(location.hash))) {
    e.preventDefault();
    if (!/^#\/?$/.test(location.hash || '#/')) location.hash = '#/';
    return;
  }
  // View shortcuts (single keys) — g-prefix-free for speed.
  const routes = { '1': '#/', '2': '#/fleet', '3': '#/inbox', '4': '#/jobs', '5': '#/search', '6': '#/usage' };
  if (routes[e.key]) { location.hash = routes[e.key]; return; }
  if (e.key === '/') { e.preventDefault(); location.hash = '#/search'; return; }
  // 'd' toggles the diff on the selected review card.
  if (e.key === 'd') { const r = selectedRow(); if (r?.dataset.dkey) { toggleDiff(r.dataset.dkey); return; } }

  if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); moveNav(1); return; }
  if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); moveNav(-1); return; }

  const row = selectedRow();
  if (!row) return;
  const d = row.dataset;
  const isLive = d.live === '1';
  if (e.key === 'Enter' || e.key === 'o') { e.preventDefault(); if (d.open) location.hash = d.open; }
  else if (e.key === 'a' || e.key === 'r') {
    // act on it: live → attach to the running worker; ended → open (composer)
    if (isLive && d.short) attachSession(d.short);
    else if (d.open) location.hash = d.open;
  } else if (e.key === 't') {
    // 't' = get me to this session in a terminal: live → attach INTO it;
    // ended → open its folder (there's no live worker to attach to).
    if (isLive && d.short) attachSession(d.short);
    else if (d.cwd) openTerminal(d.cwd);
  } else if (e.key === 'x') {
    if (d.rkey) dismissReport(d.rkey); // dismiss a finished report
  }
});

// A --resume dispatch forks to a new session id; poll jobs until the fork
// registers, then navigate so the live tail lands on the continuation.
async function followDispatch(projectKey, short, tries = 20) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const jobsList = await api('/api/jobs');
      const j = jobsList.find((x) => x.id === short);
      if (j?.sessionId) {
        location.hash = `#/session/${projectKey}/${j.sessionId}`;
        return;
      }
    } catch {}
  }
}

function entryHtml(e) {
  // harness chrome renders compact, not as fake user messages
  if (e.kind === 'command') {
    return `<div class="entry meta"><span class="who cmd">⌘</span>
      <div class="body"><span class="cmd-chip">${esc(e.text)}</span></div></div>`;
  }
  // System notices (model auto-switch/fallback, reminders) are harness chrome,
  // not conversation — render dim and compact so they don't read as a turn.
  if (e.kind === 'meta' || e.kind === 'system') {
    return `<div class="entry meta"><span class="who">SYS</span>
      <div class="body"><span class="meta-text">${esc(e.text.slice(0, 300))}</span></div></div>`;
  }
  const who = e.kind === 'user' ? 'YOU' : e.kind === 'assistant' ? modelShort(e.model || 'claude').toUpperCase() : 'SYS';
  let body = '';
  if (e.text) body += `<div>${md(e.text)}</div>`;
  if (e.tools?.length) {
    body += e.tools
      .map((t) => `<div class="tool-line">⚙ <span class="tn">${esc(t.name)}</span> <span class="ti">${esc(t.input)}</span></div>`)
      .join('');
  }
  const t = e.ts ? new Date(e.ts) : null;
  return `<div class="entry ${esc(e.kind)}">
    <span class="who">${esc(who)}</span>
    <div class="body">${body}<div class="ts">${t ? t.toLocaleString() : ''}</div></div>
  </div>`;
}

// ---------- shell: routing, SSE, clock ----------
function setBadge(n) {
  const b = $('#inbox-badge');
  b.hidden = !n;
  b.textContent = n;
}
function footStats(data) {
  const live = data.live?.length || 0;
  $('#foot-stats').textContent = `${live} live · ${data.projects.length} projects`;
}

const routes = [
  { re: /^#?\/?$/, view: viewReview, nav: 'review' },
  { re: /^#\/review/, view: viewReview, nav: 'review' },
  { re: /^#\/fleet/, view: viewFleet, nav: 'fleet' },
  { re: /^#\/inbox$/, view: viewInbox, nav: 'inbox' },
  { re: /^#\/jobs$/, view: viewJobs, nav: 'jobs' },
  { re: /^#\/search/, view: viewSearch, nav: 'search' },
  { re: /^#\/(usage|costs)/, view: viewUsage, nav: 'usage' }, // /costs kept as alias
  { re: /^#\/session\/([^/]+)\/([^/?]+)/, view: viewSession, nav: 'review' },
];

let currentRender = null;
async function render() {
  const h = location.hash || '#/';
  for (const r of routes) {
    const m = h.match(r.re);
    if (m) {
      document.querySelectorAll('.rail a').forEach((a) => a.classList.toggle('active', a.dataset.view === r.nav));
      currentRender = () => r.view(...m.slice(1));
      try {
        await currentRender();
      } catch (err) {
        main.innerHTML = `<div class="panel"><div class="empty">Error: ${esc(err.message)}</div></div>`;
      }
      return;
    }
  }
  main.innerHTML = '<div class="panel"><div class="empty">Unknown route.</div></div>';
}
window.addEventListener('hashchange', render);

// auto-refresh on backend change events (debounced by server)
let refreshTimer = null;
// Views where a live re-render would either destroy input state or trigger
// an expensive server-side operation. These refresh only on explicit action.
function refreshSuppressed() {
  // 1. User is typing in the composer or search box — never rebuild under them.
  const a = document.activeElement;
  if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && main.contains(a)) return true;
  // 2. Search view: every rebuild re-runs a blocking ripgrep on the server.
  if (location.hash.startsWith('#/search')) return true;
  return false;
}
function connectSse() {
  const es = new EventSource('/api/events');
  es.onopen = () => $('#conn').classList.remove('off');
  es.onerror = () => $('#conn').classList.add('off');
  es.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type !== 'change') return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (refreshSuppressed()) return;
      const atBottom = main.scrollHeight - main.scrollTop - main.clientHeight < 80;
      const prevScroll = main.scrollTop;
      if (currentRender) currentRender().then(() => {
        // Preserve scroll: pin to bottom on live session tail, else restore position.
        if (location.hash.startsWith('#/session/') && atBottom) main.scrollTop = main.scrollHeight;
        else main.scrollTop = prevScroll;
      }).catch(() => {});
    }, 250);
  };
}

function tickClock() {
  const d = new Date();
  $('#clock').textContent = d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
setInterval(tickClock, 1000);
tickClock();
connectSse();
render();

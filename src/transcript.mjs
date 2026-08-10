// Incremental parser for Claude Code transcript JSONL files.
// Transcripts are append-only, so each file is indexed once and then only the
// newly-appended bytes are parsed on change. All knowledge of the on-disk
// format lives here (adapter layer) — if a Claude Code release shifts the
// format, this is the only file that should need edits.
import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { costOf } from './pricing.mjs';

const index = new Map(); // path -> {offset, decoder, remainder, ino, meta}

// Usage requestIds are global, not per-file: `--resume` forks replay the full
// history (usage included, same requestIds) into a new transcript. We record
// the FIRST path that claimed each requestId, and allow re-ingest only from
// that same path — so a re-parse of the owning file (after truncation) rebuilds
// its cost instead of zeroing, and attribution is deterministic (the earliest
// file, processed first, wins) rather than call-order dependent.
const requestOwner = new Map(); // requestId -> owning path

// Test hook: reset all module state between test cases.
export function __resetIndex() {
  index.clear();
  requestOwner.clear();
}

function freshMeta() {
  return {
    sessionId: null,
    title: null,
    titleSource: null, // 'custom' wins over 'ai'
    cwd: null,
    gitBranch: null,
    version: null,
    firstTs: null,
    lastTs: null,
    lastType: null, // last meaningful entry: 'user' | 'assistant'
    lastUserText: null,
    lastAssistantText: null,
    turns: 0,
    models: {}, // model -> {input, output, cacheRead, cacheWrite5m, cacheWrite1h, cost, requests, byDay}
    usageByDay: {}, // 'YYYY-MM-DD' -> cost
    seen: new Set(), // requestIds counted in THIS file (intra-file streaming dedup)
    entries: [], // condensed timeline (capped)
    entryCount: 0,
  };
}

function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

function toolUsesOf(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ name: b.name, input: summarizeToolInput(b.name, b.input) }));
}

function summarizeToolInput(name, input) {
  if (!input) return '';
  const s =
    input.command || input.file_path || input.prompt || input.description ||
    input.query || input.url || input.skill || input.pattern || '';
  return String(s).slice(0, 200);
}

const MAX_ENTRIES = 4000; // per-session timeline cap; oldest dropped

// Harness meta-content arrives as user-role messages wrapped in XML-ish tags
// (slash commands, hook output, system reminders). Classify so the UI can
// render them as compact system chrome instead of raw angle-bracket soup —
// and so they never count as real user turns for waiting-detection.
function classifyUserText(text) {
  const t = text.trimStart();
  const cmd = t.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) {
    const args = t.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? '';
    return { kind: 'command', text: `${cmd[1].trim()} ${args.trim()}`.trim() };
  }
  if (t.startsWith('<local-command-stdout>')) {
    return { kind: 'meta', text: t.replace(/<\/?local-command-stdout>/g, '').trim() };
  }
  if (/^<(system-reminder|task-notification|local-command-caveat|command-message)/.test(t)) {
    const body = t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return { kind: 'meta', text: body.slice(0, 400) };
  }
  return { kind: 'user', text };
}

function ingestLine(meta, path, line) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    meta.parseErrors = (meta.parseErrors || 0) + 1;
    return;
  }
  if (e.sessionId && !meta.sessionId) meta.sessionId = e.sessionId;
  if (e.timestamp) {
    if (!meta.firstTs) meta.firstTs = e.timestamp;
    meta.lastTs = e.timestamp;
  }
  switch (e.type) {
    case 'custom-title':
      meta.title = e.customTitle;
      meta.titleSource = 'custom';
      break;
    case 'ai-title':
      if (meta.titleSource !== 'custom') {
        meta.title = e.aiTitle || e.title;
        meta.titleSource = 'ai';
      }
      break;
    case 'user': {
      meta.cwd = e.cwd || meta.cwd;
      meta.gitBranch = e.gitBranch ?? meta.gitBranch;
      // Sidechain (subagent) turns don't count as real user turns or timeline
      // entries — but they DO carry cost, handled in the assistant case.
      if (e.isSidechain) break;
      const text = textOfContent(e.message?.content);
      const isToolResult =
        Array.isArray(e.message?.content) &&
        e.message.content.some((b) => b.type === 'tool_result');
      if (!isToolResult && text.trim()) {
        const cls = classifyUserText(text);
        if (cls.kind === 'user') {
          meta.lastType = 'user';
          meta.lastUserText = cls.text.slice(0, 500);
          meta.turns++;
        }
        if (cls.text.trim()) pushEntry(meta, { kind: cls.kind, ts: e.timestamp, text: cls.text.slice(0, 4000) });
      }
      break;
    }
    case 'assistant': {
      meta.cwd = e.cwd || meta.cwd;
      meta.version = e.version || meta.version;
      const model = e.message?.model || 'unknown';
      const usage = e.message?.usage;
      const reqId = e.requestId || e.message?.id;
      // Cost counts for every assistant turn INCLUDING sidechain/subagent turns
      // (they are billed) — deduped by requestId, owned by the first file to claim it.
      if (usage && reqId && !meta.seen.has(reqId)) {
        const owner = requestOwner.get(reqId);
        // Count only if unclaimed or claimed by THIS file. `meta.seen` handles the
        // same requestId appearing twice in one file (streaming); `requestOwner`
        // handles the same requestId replayed into a `--resume` fork file.
        if (owner === undefined || owner === path) {
          meta.seen.add(reqId);
          if (owner === undefined) requestOwner.set(reqId, path);
          const m = (meta.models[model] ??= {
            input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0,
            cost: 0, requests: 0, byDay: {},
          });
          m.input += usage.input_tokens || 0;
          m.output += usage.output_tokens || 0;
          m.cacheRead += usage.cache_read_input_tokens || 0;
          m.cacheWrite5m += usage.cache_creation?.ephemeral_5m_input_tokens ?? (usage.cache_creation_input_tokens || 0);
          m.cacheWrite1h += usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
          m.requests++;
          const c = costOf(model, usage);
          m.cost += c;
          const day = localDay(e.timestamp);
          if (day) {
            meta.usageByDay[day] = (meta.usageByDay[day] || 0) + c;
            m.byDay[day] = (m.byDay[day] || 0) + c;
          }
        }
      }
      if (e.isSidechain) break; // cost counted; keep subagent chatter out of the timeline
      const text = textOfContent(e.message?.content);
      const tools = toolUsesOf(e.message?.content);
      if (text.trim() || tools.length) {
        meta.lastType = 'assistant';
        if (text.trim()) meta.lastAssistantText = text.slice(0, 500);
        pushEntry(meta, {
          kind: 'assistant', ts: e.timestamp, model,
          text: text.slice(0, 6000), tools,
        });
      }
      break;
    }
    case 'system': {
      const text = (e.content || e.text || '').toString();
      if (text.trim()) pushEntry(meta, { kind: 'system', ts: e.timestamp, text: text.slice(0, 1000) });
      break;
    }
    default:
      break;
  }
}

// Bucket a Z-timestamp by the operator's LOCAL day so month rollups and the
// billing CSV match what the user sees on the wall clock, not UTC.
function localDay(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pushEntry(meta, entry) {
  meta.entries.push(entry);
  meta.entryCount++;
  if (meta.entries.length > MAX_ENTRIES) meta.entries.splice(0, meta.entries.length - MAX_ENTRIES);
}

// Parse (or incrementally extend) the index for a transcript file.
export function parseTranscript(path) {
  let st;
  try {
    st = fs.statSync(path);
  } catch {
    index.delete(path);
    return null;
  }
  let rec = index.get(path);
  // Reparse from scratch on shrink OR inode change (rotation / same-path replace
  // at equal-or-greater size — size-only detection would parse mid-record garbage).
  if (rec && (st.size < rec.offset || st.ino !== rec.ino)) rec = null;
  if (!rec) {
    rec = { offset: 0, decoder: new StringDecoder('utf8'), remainder: '', ino: st.ino, meta: freshMeta() };
    index.set(path, rec);
  }
  if (st.size > rec.offset) {
    const fd = fs.openSync(path, 'r');
    try {
      const len = st.size - rec.offset;
      const buf = Buffer.alloc(len);
      // Decode only the bytes actually read; advance the offset by that count so
      // a short read or truncation race never appends zero-filled NUL bytes.
      const bytesRead = fs.readSync(fd, buf, 0, len, rec.offset);
      rec.offset += bytesRead;
      // StringDecoder holds any trailing partial multi-byte sequence across
      // chunk boundaries instead of emitting U+FFFD and corrupting the line.
      const chunk = rec.remainder + rec.decoder.write(buf.subarray(0, bytesRead));
      const lines = chunk.split('\n');
      rec.remainder = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) ingestLine(rec.meta, path, line);
    } finally {
      fs.closeSync(fd);
    }
  }
  rec.meta.mtimeMs = st.mtimeMs;
  rec.meta.size = st.size;
  return rec.meta;
}

export function sessionSummary(path) {
  const m = parseTranscript(path);
  if (!m) return null;
  let cost = 0, input = 0, output = 0;
  for (const v of Object.values(m.models)) {
    cost += v.cost;
    input += v.input + v.cacheRead + v.cacheWrite5m + v.cacheWrite1h;
    output += v.output;
  }
  return {
    sessionId: m.sessionId,
    title: m.title,
    cwd: m.cwd,
    gitBranch: m.gitBranch,
    version: m.version,
    firstTs: m.firstTs,
    lastTs: m.lastTs,
    lastType: m.lastType,
    lastUserText: m.lastUserText,
    lastAssistantText: m.lastAssistantText,
    turns: m.turns,
    models: Object.keys(m.models),
    cost,
    inputTokens: input,
    outputTokens: output,
    mtimeMs: m.mtimeMs,
  };
}

export function sessionDetail(path) {
  const m = parseTranscript(path);
  if (!m) return null;
  return { ...sessionSummary(path), entries: m.entries, entryCount: m.entryCount, usage: m.models };
}

export function sessionUsage(path) {
  const m = parseTranscript(path);
  if (!m) return null;
  return { sessionId: m.sessionId, cwd: m.cwd, models: m.models, usageByDay: m.usageByDay, firstTs: m.firstTs, lastTs: m.lastTs, title: m.title };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { priceFor, costOf } from '../src/pricing.mjs';
import { sessionSummary, sessionUsage, __resetIndex } from '../src/transcript.mjs';

// Module-global parser state is order-coupled across tests; reset per case.
import { beforeEach } from 'node:test';
beforeEach(() => __resetIndex());

test('pricing matches published rates', () => {
  assert.deepEqual(priceFor('claude-fable-5'), { input: 10, output: 50 });
  assert.deepEqual(priceFor('claude-opus-5'), { input: 5, output: 25 });
  assert.deepEqual(priceFor('claude-opus-4-8'), { input: 5, output: 25 });
  assert.deepEqual(priceFor('claude-sonnet-5'), { input: 3, output: 15 });
  assert.deepEqual(priceFor('claude-haiku-4-5-20251001'), { input: 1, output: 5 });
});

test('costOf is cache-aware', () => {
  const usage = {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 },
  };
  // opus-5: 5 + 25 + 0.5 (read) + 6.25 (5m write) + 10 (1h write)
  assert.ok(Math.abs(costOf('claude-opus-5', usage) - 46.75) < 1e-9);
});

test('transcript parser: titles, usage dedup, waiting detection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcc-'));
  const p = path.join(dir, 'abc.jsonl');
  const lines = [
    { type: 'custom-title', sessionId: 'abc', customTitle: 'my session' },
    { type: 'user', sessionId: 'abc', cwd: '/tmp/proj', timestamp: '2026-08-10T00:00:00Z', message: { role: 'user', content: 'hello' } },
    { type: 'assistant', sessionId: 'abc', requestId: 'r1', timestamp: '2026-08-10T00:00:05Z',
      message: { model: 'claude-opus-5', content: [{ type: 'text', text: 'hi there' }], usage: { input_tokens: 10, output_tokens: 20 } } },
    // duplicate requestId — must not double-count
    { type: 'assistant', sessionId: 'abc', requestId: 'r1', timestamp: '2026-08-10T00:00:06Z',
      message: { model: 'claude-opus-5', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }], usage: { input_tokens: 10, output_tokens: 20 } } },
  ];
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

  const s1 = sessionSummary(p);
  assert.equal(s1.title, 'my session');
  assert.equal(s1.cwd, '/tmp/proj');
  assert.equal(s1.lastType, 'assistant'); // → would surface as "waiting" when live+idle
  assert.equal(s1.inputTokens, 10);
  assert.equal(s1.outputTokens, 20);
  assert.equal(s1.turns, 1);

  // incremental append picks up only new bytes
  fs.appendFileSync(p, JSON.stringify({
    type: 'user', sessionId: 'abc', timestamp: '2026-08-10T00:01:00Z',
    message: { role: 'user', content: 'follow-up' },
  }) + '\n');
  const s2 = sessionSummary(p);
  assert.equal(s2.turns, 2);
  assert.equal(s2.lastType, 'user');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cross-fork dedup: --resume replay does not double-count cost', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcc-'));
  const mk = (name, lines) => {
    const fp = path.join(dir, name);
    fs.writeFileSync(fp, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    return fp;
  };
  const turn = (req) => ({ type: 'assistant', sessionId: 's', requestId: req, timestamp: '2026-08-10T00:00:05Z',
    message: { model: 'claude-opus-5', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 1_000_000, output_tokens: 0 } } });
  // parent owns req A; fork replays A (history) + adds B
  const parent = mk('parent.jsonl', [turn('A')]);
  const fork = mk('fork.jsonl', [turn('A'), turn('B')]);
  const pc = sessionSummary(parent).cost; // parses first → owns A
  const fc = sessionSummary(fork).cost;   // A already owned by parent → only B counts
  assert.ok(Math.abs(pc - 5) < 1e-9, `parent should own A ($5): ${pc}`);
  assert.ok(Math.abs(fc - 5) < 1e-9, `fork should count only B ($5), not replayed A: ${fc}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('UTF-8 multibyte sequence split across an incremental read boundary is not corrupted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcc-'));
  const p = path.join(dir, 'u.jsonl');
  const line = JSON.stringify({ type: 'user', sessionId: 'u', timestamp: '2026-08-10T00:00:00Z',
    message: { role: 'user', content: 'café ☕ 日本語' } }) + '\n';
  const buf = Buffer.from(line, 'utf8');
  // write first half ending mid-multibyte-char, parse, then the rest
  const cut = buf.indexOf(Buffer.from('☕', 'utf8')) + 1; // inside the ☕ sequence
  fs.writeFileSync(p, buf.subarray(0, cut));
  sessionSummary(p); // partial — must not throw or corrupt
  fs.appendFileSync(p, buf.subarray(cut));
  const s = sessionSummary(p);
  assert.equal(s.lastUserText, 'café ☕ 日本語');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('truncation / same-path replace triggers a clean reparse (cost rebuilds, not zeroes)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcc-'));
  const p = path.join(dir, 't.jsonl');
  const turn = { type: 'assistant', sessionId: 't', requestId: 'Z', timestamp: '2026-08-10T00:00:00Z',
    message: { model: 'claude-opus-5', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 1_000_000, output_tokens: 0 } } };
  fs.writeFileSync(p, JSON.stringify(turn) + '\n');
  assert.ok(Math.abs(sessionSummary(p).cost - 5) < 1e-9);
  // rewrite the file shorter (truncation) — reparse must re-own Z and rebuild cost, not zero it
  fs.writeFileSync(p, JSON.stringify(turn) + '\n');
  assert.ok(Math.abs(sessionSummary(p).cost - 5) < 1e-9, 'reparse must rebuild cost');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cost buckets by local day for month rollups', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcc-'));
  const p = path.join(dir, 'd.jsonl');
  const ts = '2026-08-10T12:00:00Z';
  fs.writeFileSync(p, JSON.stringify({ type: 'assistant', sessionId: 'd', requestId: 'D', timestamp: ts,
    message: { model: 'claude-opus-5', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 1000, output_tokens: 0 } } }) + '\n');
  const u = sessionUsage(p);
  const localDay = `${new Date(ts).getFullYear()}-${String(new Date(ts).getMonth() + 1).padStart(2, '0')}-${String(new Date(ts).getDate()).padStart(2, '0')}`;
  assert.ok(u.usageByDay[localDay] > 0, `expected cost bucketed under local day ${localDay}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

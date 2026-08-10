# ⌬ Lattice Claude Console

Local mission-control for your Claude Code fleet. One dark dashboard over every
project, session, background job, and dollar spent — a better answer than
juggling iTerm2 tabs or opening each session one at a time.

![status](https://img.shields.io/badge/runtime-node%20%E2%89%A518-brightgreen) ![deps](https://img.shields.io/badge/dependencies-zero-blue)

## What it does

- **Fleet** — every project under `~/.claude/projects` with its sessions, live
  status (`working` / `stalled` / `waiting` / `idle` / `done` / `ended`), last
  activity, token totals and estimated cost. Live status comes from the real
  session registry + PID liveness, not mtime guessing; `stalled` flags a busy
  session with no transcript movement for 10+ minutes.
- **Inbox (waiting on you)** — sessions that said something and are blocked on
  your reply, plus background jobs whose final report is ready. The hero view:
  interruption routing, not another dashboard to poll.
- **Session detail + composer** — the full conversation timeline (prompts,
  responses, tool calls; harness chrome like `/commands` and system reminders
  rendered as compact chips, not raw XML), live-tailing over SSE. **Type a
  message and hit Enter to send it to the session** — dispatched via
  `claude --bg --resume`, and the console automatically follows the
  continuation. Plus one-click copy-resume and open-in-iTerm.
- **Jobs** — background jobs with state, intent, token usage, final report,
  and expandable **run history** (checkpoint timeline).
- **Costs** — cache-aware cost estimates per project / model / day, month
  filter, sparkline activity, and **CSV export** for month-end client
  attribution. Fork-aware: replayed history is never double-counted.
- **Search** — full-text search across every transcript (including subagent
  transcripts), ripgrep-fast, linking straight into the session timeline.

## Run

```sh
npm start
```

That's it — zero dependencies. It prints (and opens) a tokenized URL like
`http://127.0.0.1:4110/?token=…`. Keep it running on a spare display.

- Binds **127.0.0.1 only**; every request requires the bearer token
  (persisted at `~/.claude/console-token`, mode 600) — protects against
  DNS-rebinding / drive-by localhost requests.
- Read-only over `~/.claude`. The only action that touches anything else is
  the explicit "open in terminal" button.
- `PORT=xxxx` to change port, `LCC_OPEN=0` to suppress auto-open,
  `CLAUDE_DIR=…` to point at a different Claude home.

### Launch at login (optional)

```sh
cat > ~/Library/LaunchAgents/com.lattice.claude-console.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.lattice.claude-console</string>
  <key>ProgramArguments</key><array>
    <string>$(command -v node)</string>
    <string>$(pwd)/src/server.mjs</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>LCC_OPEN</key><string>0</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
EOF
launchctl load ~/Library/LaunchAgents/com.lattice.claude-console.plist
```

## Architecture

```
~/.claude/sessions/*.json     live registry (pid, status)  ─┐
~/.claude/jobs/*/state.json   background jobs               ├─▶ src/data.mjs ──▶ HTTP API ──▶ vanilla-JS SPA
~/.claude/projects/**/*.jsonl transcripts (append-only)    ─┘        │                          (public/)
                                    │                                └─ fs.watch → SSE → live refresh
                              src/transcript.mjs
                              (incremental byte-offset parser)
```

- Transcripts are append-only JSONL, so `src/transcript.mjs` indexes each file
  once and re-parses **only newly appended bytes** — live tailing is near-free
  even on multi-hundred-MB transcripts.
- All knowledge of Claude Code's on-disk formats is confined to
  `src/transcript.mjs` + `src/data.mjs` (the adapter layer). If a Claude Code
  release shifts a format, fix it there; everything degrades to partial views
  rather than crashing.
- Cost estimates use list pricing in `src/pricing.mjs` (cache reads at 0.1×,
  5m/1h cache writes at 1.25×/2×). Update that file when prices change.

## Tests

```sh
npm test
```

Covers pricing, cache-aware cost math, transcript parsing (titles, usage
dedup by request id, waiting detection), and incremental append handling.

## Project docs

- `docs/project-understanding.md` — scope, decisions, and workstreams
- `docs/panel-review-2026-08-10.md` — the stakeholder panel review that shaped v1

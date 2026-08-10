# Dispatch — Requirements & Build Specification

**A local supervision console for 8–10 concurrent Claude Code sessions.**

| | |
|---|---|
| Version | **2.0** (supersedes 1.0) |
| Date | 9 August 2026 |
| Target platform | macOS (Apple Silicon), MDM-managed, admin rights available |
| Primary language | Python 3.11+ |
| Status | **Gated — steps 0–2 may begin; step 6 blocked pending governance sign-off** |

---

## 0. Changelog — what the panel review changed

v2.0 incorporates the findings in `JTBD-AND-PANEL-REVIEW.md`. Every change below traces to a panelist's P0 or P1 finding. v1.0 is retained as `REQUIREMENTS-v1.0-superseded.md`.

| # | Change | Source |
|---|---|---|
| 1 | **Objective declaration is now a blocking prerequisite** (§1.4) | Adeyemi P0 |
| 2 | **Baseline instrumentation precedes all behaviour change**; new §5 Measurement | Ellery P0 |
| 3 | **Counter-metric operationalised** with four concrete measures (§5.3) | Ellery P0 |
| 4 | **ABAB control periods** required before claiming improvement (§5.4) | Ellery P1 |
| 5 | **`event_log` redesigned**: metadata-and-hashes by default, payload capture opt-in and off, 7-day retention, encryption at rest (§7.4) | Okonkwo P0 |
| 6 | **New §4 Governance** — data classification and IT notification are gates on the gating hook | Okonkwo P0 |
| 7 | **Fail-open and fail-closed paths formally separated** (§9.6) | Okonkwo P1 / Raghunathan P1 |
| 8 | **Render-injection defences added** as first-class requirements (§13.4) | Okonkwo P1 / Raghunathan P1 |
| 9 | **Rendezvous state machine fully specified**, with orphan reaping and heartbeat (§9.7) | Raghunathan P0 |
| 10 | **`dispatch doctor` moved from last phase to step 2** | Raghunathan P0 |
| 11 | **Gating timeout cut 900s → 180s** with an explicit in-UI extend action | Raghunathan P1 |
| 12 | **Phases reordered**: artifact layer now precedes the gating hook | Lindqvist P0 |
| 13 | **Kill criteria with a date**, and a maintenance budget with a turn-it-off policy (§17) | Lindqvist P1 / future-self P0 |
| 14 | **Differentiators ranked** and built in defensibility order (§16) | Lindqvist P2 |
| 15 | **Digest must function with the console closed** — promoted to load-bearing | future-self P1 / Raghunathan P2 |
| 16 | **Capacity advisory** when actionable depth exceeds 5 (§12.5) | future-self P2 |
| 17 | **Hard STOP gates** added at steps 3 and 4 | Ellery + Lindqvist |

---

## 1. Overview

### 1.1 Problem

An operator runs 8–10 independent application projects, each with a long-running Claude Code CLI session in an iTerm2 pane. The current interaction model is serial: to see or act on another session the operator suspends the foreground session (`Ctrl+Z`), looks around, and returns. Three specific costs follow:

1. **Discovery cost** — finding which session needs a decision requires visiting sessions one by one.
2. **Context-switch cost** — acting requires entering the session, losing the overview.
3. **Attention starvation** — finished work sits unnoticed while the operator watches whichever pane is visible.

### 1.2 Solution

A single always-available console, separate from the session panes, that aggregates every session's state into one prioritised board; lets the operator resolve requests without entering the session; auto-advances so triage is a flow rather than a hunt; presents durable **artifacts** (diff, plan, walkthrough) for asynchronous review; and batches notification into one digest.

### 1.3 What this is not

- Not a replacement for the Claude Code CLI or TUI. Panes remain where deep work happens.
- Not a re-implementation of `claude agents`. It complements it (§3.2).
- Not an orchestrator. It does not choose work, spawn sessions, or manage worktrees.
- Not remote access. Nothing is reachable from outside the machine.

### 1.4 Objective declaration — BLOCKING PREREQUISITE

**No work may begin until this section is completed in writing.**

The build differs materially depending on which objective this serves:

| | Objective | Implied build |
|---|---|---|
| **A** | Personal throughput | Full sequence, steps 0–7 |
| **B** | Organisational reference implementation for agent supervision | Steps 0–5 plus documentation and generalisation; prioritise the audit log; publish as a plugin |
| **C** | Demonstrated frontier fluency / positioning | Steps 0–4 only, then write-up and demo. Stop. |

Declared objective: `________________`  Date: `________`

Rationale (three sentences): `________________`

If the answer is **C**, the correct total investment is roughly two to three days, not ten, and the remaining days return to higher-ranked programmes.

---

## 2. Goals and non-goals

### 2.1 Goals

| ID | Goal | Measure of success |
|---|---|---|
| G1 | Eliminate discovery cost | Operator knows which sessions need action without visiting any session |
| G2 | Act without switching | Resolve any request without entering the pane |
| G3 | Continuous triage | Resolving an item presents the next automatically |
| G4 | Asynchronous review | Completed work reviewed as an artifact, not by reading a live pane |
| G5 | Non-interrupting steering | Batched comments instead of blocking prompts |
| G6 | Attention economy | One batched digest; works when the console is closed |
| G7 | Reduce request volume at source | Permission configuration removes routine prompts before they reach the console |
| **G8** | **Falsifiable improvement** | **Every claimed gain is measured against a recorded pre-change baseline with a control period** |

### 2.2 Non-goals

Multi-machine or remote operation; multi-user features; any cloud, relay, tunnel, or hosted service; mobile, tablet, or wearable surfaces; voice input; replacing the native CLI with an Agent SDK harness.

---

## 3. Design principles

### 3.1 Artifact-first, interrupt-second

At 8–10 agents nobody watches live output. The leading orchestration products converge on this. Google Antigravity pairs its Manager surface with **Artifacts** — task lists, plans, walkthroughs, screenshots, browser recordings — and permits inline comment on a plan as one would on a document. GitHub's Agent HQ routes agent output through the **pull request**, reusing existing review muscle memory, with PR comments as the steering channel.

The transferable insight, independent of their cloud infrastructure: **the primary surface is a review queue of artifacts, and synchronous interrupts are a cost to minimise, not a queue to optimise.**

Two surfaces, two tempos:

- **Needs input** — fast, keyboard-driven triage. Kept as small as possible.
- **Ready for review** — slower, deliberate artifact reading. Where most operator time should go.

Per resolved decision D2 (§18), these are **separate passes with separate entry points**, not one merged queue. Mixing tempos encourages rushing the reviews that matter most.

### 3.2 Do not duplicate `claude agents`

Claude Code ships an Agent View providing a state-grouped fleet table, a **peek** interaction to see and answer a pending question without fully attaching, attach/detach navigation, and `claude agents --json` for scripting.

| Capability | Agent View | Console |
|---|---|---|
| Fleet table by state | Yes | **Consume via `--json`, do not rebuild** |
| Peek and reply | Yes | Complement with richer context |
| Cross-project diff review | No | **Build — differentiator 1** |
| Batched inline comments | No | **Build — differentiator 2** |
| Single batched digest | No | **Build — differentiator 3** |
| Durable walkthrough artifact | No | **Build last — differentiator 4, most likely to be commoditised** |
| Custom priority with ageing | Limited | Build |

**Requirement:** before building any feature, verify current Agent View does not already cover it. Integrate rather than duplicate.

### 3.3 Attention is the scarce resource

Practitioner consensus puts 3–5 concurrently *steerable* large tasks at the human ceiling; the bottleneck is review bandwidth, not agent capacity. The console makes 8–10 running sessions tolerable by serialising their demands — it must not encourage more parallelism. Hence the capacity advisory (§12.5).

---

## 4. Governance — GATE ON THE GATING HOOK

**Step 6 (the gating hook) must not be built until §4.1 and §4.2 are complete.** Steps 0–5 raise none of these concerns and may proceed.

### 4.1 Data classification

A `PreToolUse` hook that observes and can modify every tool call made against company source code, and a local store retaining that content, together constitute a new data asset and a new security control on a managed corporate endpoint.

| ID | Requirement |
|---|---|
| GV1 | Classify the `event_log` and `request` stores against company data-classification policy before first payload write |
| GV2 | Default capture is **metadata and hashes only** — event type, tool name, session, timestamps, SHA-256 of inputs. Never raw payloads. |
| GV3 | Raw payload capture is **opt-in per project, default off**, and visibly indicated in the UI when active |
| GV4 | Store on an encrypted volume (FileVault is necessary but not sufficient — document the reasoning) or encrypt the DB at rest |
| GV5 | Retention **7 days**, enforced by a scheduled prune, not by convention |
| GV6 | Document what device wipe, backup, and legal-discovery mean for this store |
| GV7 | Secret redaction is a stated non-guarantee. Because redaction of secrets from arbitrary tool input is unsolved, GV2 (do not capture) is the control — not redaction. |

### 4.2 IT and security notification

| ID | Requirement |
|---|---|
| GV8 | Notify endpoint security of the hook interception layer and the local store before step 6. Record the date and the responder. |
| GV9 | Document the change as a reviewable control with a named owner |
| GV10 | If sanctioned, publish the pattern internally so it becomes policy rather than precedent-by-accident |

Twenty minutes of this conversation converts shadow tooling into a sanctioned reference implementation — which is also what objective B requires.

---

## 5. Measurement — PRECEDES ALL BEHAVIOUR CHANGE

**No permission rule is changed, and no console feature is built, until §5.1 has run for two full working days.**

### 5.1 Baseline instrumentation

Passive logging only. No gating, no permission changes, no UI.

| Metric | Source | Recorded as |
|---|---|---|
| Gating-eligible prompts per hour | `PreToolUse` event log | Hourly histogram, by tool and project |
| Time-to-unblock | Interval from blocking event to next `UserPromptSubmit` in that session | Distribution, p50/p90/max |
| Agent idle-waiting share | Transcript timestamps, **not** console-derived | % of session runtime awaiting human |
| Speculative pane visits | iTerm2 session-activation events | Count per hour |
| Self-reported dread | One question, once daily, 1–5 | Time series |

Idle-waiting is computed from transcript timestamps rather than console telemetry, because console-derived metrics are biased by console usage.

### 5.2 Baseline record

Baseline values are written to `~/.dispatch/baseline.json`, committed to the repo, and **never overwritten**. Every later claim references it.

### 5.3 Counter-metric — operationalised

"Decision quality holds" is unmeasurable as prose. It means all four of:

| Measure | Definition | Failure signal |
|---|---|---|
| Plan abandonment | Plans approved, then abandoned or materially rewritten within 48h | Rate rises vs baseline |
| Revert rate | Commits from agent sessions reverted within 48h | Rate rises vs baseline |
| Time-on-decision (P0) | Seconds between a plan artifact opening and the approve action | **Falls** vs baseline — the rubber-stamp signal |
| Approval sampling | 10% of approvals reviewed retrospectively each week | Any wrong approval that a slower read would have caught |

If time-on-decision for P0 plans falls after the console ships, the console is producing the failure mode it exists to prevent. That must be visible.

### 5.4 Control periods

n=1 with no control means novelty effects and regression to the mean will present as gains. Required before claiming improvement: **ABAB** — two weeks with the console enabled, two weeks disabled, repeated once. Crude, and the difference between evidence and impression.

---

## 6. Constraints

### 6.1 Locality

| ID | Constraint |
|---|---|
| C1 | All components run on the operator's Mac. No data leaves it except Claude Code's existing model API traffic. |
| C2 | Any listener binds `127.0.0.1` or uses a Unix domain socket. No `0.0.0.0`. |
| C3 | No cloud relays, tunnels, hosted push, or chat bridges. |
| C4 | No dependency on Remote Control, Claude Code on the web, or third-party session relays. |

### 6.2 Platform and device management

| ID | Constraint |
|---|---|
| C5 | No kernel, DriverKit/system, or network extension. |
| C6 | Must not require Accessibility or Input Monitoring TCC permission — MDM can deny these and can never force-grant them. |
| C7 | Must not require Screen Recording TCC permission. |
| C8 | No VPN or mesh networking. |

The iTerm2 Python API, iTerm2 Triggers, tmux control commands, Unix sockets, and SQLite all satisfy C5–C7 with no TCC grant. AppleScript/System Events injection requires Accessibility and is therefore prohibited (see I6).

### 6.3 Preserve the existing workflow

| ID | Constraint |
|---|---|
| C9 | Sessions remain the native `claude` CLI with its normal TUI. |
| C10 | Sessions run in iTerm2 panes, each attached to a **plain** tmux session for crash persistence. |
| C11 | **`tmux -CC` must not be used.** Anthropic documents it as incompatible with Claude Code's fullscreen renderer; reported symptoms include a dead mouse wheel and terminal-state corruption on double-click. Plain tmux inside iTerm2 is documented as working. |

---

## 7. Architecture

### 7.1 Components

```
┌──────────────────────────────────────────────────────────────────┐
│  iTerm2 window                                                    │
│  ┌────────────┬────────────┬────────────┬────────────┐            │
│  │ pane 1     │ pane 2     │ pane 3     │  … pane N  │            │
│  │ tmux sess  │ tmux sess  │ tmux sess  │            │            │
│  │  claude    │  claude    │  claude    │            │            │
│  └────────────┴────────────┴────────────┴────────────┘            │
└──────────────────────────────────────────────────────────────────┘
        │ hooks fire (subprocess, stdin JSON)
        ▼
  hook_client.py — zero third-party imports, <50ms for auto-allow
        │  • safe-pattern pre-filter (never contacts broker)
        │  • UDS connect; for gating events: BLOCK on rendezvous
        │  • heartbeat check; fail-open to `ask` on any fault
        ▼
  UDS ~/.dispatch/broker.sock (mode 0600)
        ▼
  broker (launchd-managed daemon)
        │  • rendezvous coordinator (§9.7 state machine)
        │  • SQLite WAL store (§8)
        │  • artifact builder (git diff, transcript → walkthrough)
        │  • `claude agents --json` poller
        │  • digest scheduler — MUST run with the console closed
        │  • iTerm2 API client (activate, send text)
        │  • serves UI on 127.0.0.1
        ▲                                    │
        │ decisions, comments                │ state, artifacts (SSE)
        ▼                                    ▼
  console UI — the operator surface
```

### 7.2 Why a broker daemon

Hooks are short-lived per-event subprocesses; they must start fast and must not own state. Gating hooks need to block until a human decides, so something long-lived must hold that rendezvous. The UI may be closed or restarting, so requests must outlive it. **And the digest must fire when the console is closed** — which alone requires a daemon.

### 7.3 UI implementation

**Option A (recommended): localhost web UI.** FastAPI serving a static React bundle on `127.0.0.1:8787`, state over SSE, opened in a Chrome app-mode window.

**Option B: Textual TUI.** Terminal-native, no browser process, and eliminates the entire render-injection class (§13.4).

Decision retained as A for artifact rendering quality, **but** note the panel's split: Option B removes a security class and a process, at the cost of diff fidelity. If §13.4 escaping proves burdensome, switch. Either way the digest lives in the broker, not the UI.

### 7.4 Process lifecycle

- **broker:** per-user launchd agent, `KeepAlive` and `RunAtLoad` true. Logs to `~/.dispatch/logs/` with rotation. On start, runs the reconciliation pass in §9.7.
- **hook_client:** transient, one per invocation.
- **UI:** on demand; tolerates broker restart and vice versa.
- **Sessions:** entirely unaffected by console lifecycle.

---

## 8. Data model

SQLite at `~/.dispatch/dispatch.db`; `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`. File mode 0600 on an encrypted volume (GV4).

```sql
CREATE TABLE session (
  session_id      TEXT PRIMARY KEY,
  project         TEXT NOT NULL,
  cwd             TEXT NOT NULL,
  transcript_path TEXT,
  iterm_session   TEXT,
  tmux_target     TEXT,
  state           TEXT NOT NULL,
  state_since     INTEGER NOT NULL,
  summary         TEXT,
  pinned          INTEGER NOT NULL DEFAULT 0,
  capture_payloads INTEGER NOT NULL DEFAULT 0,   -- GV3: opt-in, per project
  last_seen       INTEGER NOT NULL
);

CREATE TABLE request (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT NOT NULL REFERENCES session(session_id),
  kind            TEXT NOT NULL,      -- permission|plan|question|error|turn_end|review
  hook_event      TEXT NOT NULL,
  tool_name       TEXT,
  tool_input_hash TEXT NOT NULL,      -- GV2: always
  tool_input      TEXT,               -- GV3: NULL unless capture_payloads
  prompt_text     TEXT,               -- human-readable ask; redaction non-guarantee GV7
  options         TEXT,
  base_priority   INTEGER NOT NULL,
  enqueued_at     INTEGER NOT NULL,
  deadline_at     INTEGER NOT NULL,   -- enqueued_at + timeout; drives countdown
  extends         INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL,      -- see §9.7 state machine
  decision        TEXT,
  decision_reason TEXT,
  updated_input   TEXT,
  answered_at     INTEGER,
  snooze_until    INTEGER,
  rendezvous      TEXT,
  claimed_by      TEXT,               -- hook process token
  last_heartbeat  INTEGER
);

CREATE TABLE artifact (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES session(session_id),
  kind        TEXT NOT NULL,          -- diff|walkthrough|plan|test_result
  built_at    INTEGER NOT NULL,
  git_head    TEXT,
  tree_hash   TEXT,                   -- staleness detection
  body_path   TEXT,                   -- spilled to artifacts/ when large
  body        TEXT,
  stale       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE comment (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  artifact_id INTEGER REFERENCES artifact(id),
  file_path   TEXT,
  line_ref    TEXT,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  sent_at     INTEGER
);

CREATE TABLE event_log (              -- GV2: metadata and hashes by default
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  session_id  TEXT,
  hook_event  TEXT,
  tool_name   TEXT,
  payload_hash TEXT,
  payload     TEXT,                   -- GV3: NULL unless capture_payloads
  expires_at  INTEGER NOT NULL        -- GV5: ts + 7 days, pruned on schedule
);

CREATE TABLE metric_sample (          -- §5 measurement
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  metric      TEXT NOT NULL,
  value       REAL NOT NULL,
  session_id  TEXT,
  phase       TEXT                    -- baseline|A|B for ABAB periods
);

CREATE INDEX idx_request_pending ON request(status, base_priority, enqueued_at);
CREATE INDEX idx_request_deadline ON request(status, deadline_at);
CREATE INDEX idx_event_expiry ON event_log(expires_at);
```

---

## 9. Hook integration

### 9.1 Events consumed

| Hook event | Matcher | Purpose | Blocking |
|---|---|---|---|
| `PreToolUse` | `ExitPlanMode` | Plan approval | **Yes** |
| `PreToolUse` | `AskUserQuestion` | Clarifying question | **Yes** |
| `PreToolUse` | `Bash\|Edit\|Write` | Permission not covered by allow-rules | **Yes** |
| `Stop` | — | Turn complete; work may be reviewable | No |
| `SubagentStop` | — | Subagent finished | No |
| `Notification` | `permission_prompt\|idle_prompt` | Supplementary signal only | No |
| `PostToolUseFailure` | — | Error / blocked | No |
| `PreCompact` | — | Compaction imminent | No |
| `SessionStart` / `SessionEnd` | — | Register / deregister | No |
| `UserPromptSubmit` | — | Operator acted in-pane; clear pending | No |

### 9.2 Why `PreToolUse` is the gate

It fires before the permission-mode check, so a `deny` holds even under permissive modes. Alternatives are less dependable: `Notification:idle_prompt` fires only after a fixed interval reported as hardcoded at 60s; a regression was reported in which `Notification:permission_prompt` stopped firing while the model was still working; no hook fires for `AskUserQuestion` as a `Notification`; `PermissionRequest` has been reported unreliable for `deny` and does not fire in `-p` mode. **All gating logic lives in `PreToolUse`. Other events are advisory.**

### 9.3 Input contract

Fields relied upon: `session_id`, `cwd`, `transcript_path` (use it — never reconstruct the path), `hook_event_name`, `permission_mode`, `tool_name`, `tool_input`, `message`.

### 9.4 Output contract

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "approved in Dispatch by operator",
    "updatedInput": { "command": "npx prisma migrate deploy --dry-run" }
  }
}
```

- `permissionDecision` ∈ `allow` | `deny` | `ask` | `defer`.
- `updatedInput` nests **inside** `hookSpecificOutput`, not top-level.
- Exit 0 with JSON = structured decision. Exit 2 = block, stderr fed to the model. Never both; JSON is discarded on exit 2.
- `ask` returns control to Claude Code's own in-pane prompt — the correct fallback on timeout or fault.
- Do not pair `updatedInput` with `defer`.

### 9.5 Timeouts — REVISED

| ID | Requirement |
|---|---|
| H2 | Hook `timeout` is **180 seconds**, set explicitly per hook. Never rely on the default. |
| H2a | The UI offers **Extend (+180s)** on any pending gating request, up to 3 extensions. Beyond that it expires. |
| H3 | On expiry the hook emits `ask` and the request is marked `expired` and shown in history. |
| H4 | A live countdown is displayed for every pending gating request. Nothing expires invisibly. |

Rationale for the cut from 900s: a forgotten request held a tool call for fifteen minutes, during which the session appeared alive and was not. 180s with explicit extension makes the operator's absence visible quickly and hands control back to the pane.

### 9.6 Fail-open vs fail-closed — FORMALLY SEPARATED

The two are not interchangeable and v1.0 conflated them.

| Path | Behaviour on fault | Rationale |
|---|---|---|
| Convenience gating (routing a prompt to the console) | **Fail open** → emit `ask` within 500ms | Availability. The pane's own prompt takes over. Sessions must never hang because the console is down. |
| Anything matching `permissions.deny` | **Unreachable by console code** | Safety. A deny is enforced by Claude Code settings, never by a console decision path, and therefore cannot lapse when the console is down. |
| Safe-pattern auto-allow pre-filter | **Fail closed** → if the pattern list cannot be read, do not auto-allow; emit `ask` | A pre-filter that keeps allowing when its configuration is unreadable is a silent widening of permissions. |

| ID | Requirement |
|---|---|
| H1 | If the broker socket is unavailable, the hook emits `ask` and exits 0 within **500ms** |
| H1a | Every decision path is annotated in code as availability or safety, and unit-tested for its fault behaviour |
| H5 | `hook_client.py` has no third-party imports and does not import the broker package |

### 9.7 Rendezvous state machine — NEW, was under-specified

The highest-risk component. Ten sessions, each able to hold a call open, coordinating through one store and one socket.

```
                 enqueue
                    │
                    ▼
  ┌──────────┐  hook connects   ┌──────────┐  operator decides  ┌──────────┐
  │ pending  │ ───────────────▶ │ claimed  │ ─────────────────▶ │ answered │
  └──────────┘                  └──────────┘                    └──────────┘
       │                          │      │
       │ deadline passed          │      │ heartbeat lapsed >30s
       ▼                          │      ▼
  ┌──────────┐                    │  ┌──────────┐
  │ expired  │ ◀──────────────────┘  │ orphaned │
  └──────────┘   deadline passed     └──────────┘
       │                                  │
       └──────────► emit `ask` ◀───────────┘
```

| ID | Requirement |
|---|---|
| RV1 | A request is `claimed` only when a hook has connected and presented its token; `claimed_by` and `last_heartbeat` are recorded |
| RV2 | The hook heartbeats every 10s while waiting. Broker marks `orphaned` after 30s of silence. |
| RV3 | The hook detects a dead broker mid-wait via the same heartbeat and fails open to `ask` — not only at connect time |
| RV4 | **On broker start, a reconciliation pass resolves every non-terminal row**: `pending`/`claimed` past deadline → `expired`; `claimed` with no live socket → `orphaned` |
| RV5 | Decision delivery is idempotent and at-most-once per rendezvous token; a duplicate delivery is logged and discarded |
| RV6 | Only one `pending` or `claimed` gating request per session at any time |
| RV7 | Concurrency test in CI-equivalent: 10 simultaneous gating requests, assert correct decision to correct hook, zero cross-talk, zero orphans |

### 9.8 Known defects to design around

| Defect | Impact | Mitigation |
|---|---|---|
| `PreToolUse` `deny` reported ignored for `Edit` | A denied edit may still be written | Never treat hook `deny` as a security boundary for writes. Hard bans live in `permissions.deny`. Optionally `chmod 444` before returning `deny`. |
| `PreToolUse` `ask` reported to bypass a settings `deny` | Denied command could execute | Never emit `ask` for anything in the deny list; resolve to explicit `deny` |
| `PreToolUse` does not fire in `-p` mode | No gating for scripted runs | Interactive sessions only; document the gap |
| Competing `PreToolUse` hooks | Ambiguous outcome | Precedence `deny` > `defer` > `ask` > `allow`; one gating hook per matcher |

**All defect claims must be re-verified by `dispatch doctor --hooks` against the installed version (§10).**

---

## 10. Version verification — NOW STEP 2, NOT LAST

Claude Code's hook surface moves quickly and several depended-upon behaviours are reported version-specific or defective. `dispatch doctor --hooks` empirically verifies:

1. `claude --version`, recorded and pinned in config.
2. Every configured hook event actually fires.
3. `allow`, `deny`, `ask`, `defer`, and `updatedInput` each produce the expected effect — **including specifically that `deny` blocks an `Edit`**.
4. Timeout behaviour: whether an expired hook is reported to the model as a rejection or as a non-response.
5. `claude agents --json` schema matches the parser.
6. Which `Notification` matchers fire in which states.

| ID | Requirement |
|---|---|
| V1 | `doctor` is built in **step 2**, before any dependent feature |
| V2 | Re-run after every Claude Code upgrade; a launchd watch on the binary's mtime prompts it |
| V3 | A previously verified behaviour that regresses raises a **blocking banner in the UI**, naming the behaviour and the version |

---

## 11. Request model

### 11.1 State vocabulary

Adopt Claude Code's own labels: `Needs input` · `Ready for review` · `Working` · `Blocked` · `Completed`, plus a `Pinned` affordance. Do not invent alternatives; follow upstream changes.

### 11.2 Taxonomy and priority

Ordered by **value of human judgement × whether the agent is blocked**. Rationale: routine permission prompts are approved at a very high rate; plan approvals are rejected far more often — so plans deserve attention and permissions deserve automation.

| Pri | Kind | Trigger | Handling |
|---|---|---|---|
| P0 | Plan approval | `PreToolUse:ExitPlanMode` | **Never auto-approve. Approve disabled until the plan artifact has been opened (U8).** |
| P1 | Clarifying question | `PreToolUse:AskUserQuestion` | Options plus recent transcript context |
| P2 | Blocked / error | `PostToolUseFailure`, rate-limit signals | Error and last tool call |
| P3 | Turn complete | `Stop` | Offer to assign next work |
| P4 | Ready for review | `Stop` + dirty working tree | Build diff, then walkthrough |
| P5 | Permission request | `PreToolUse:Bash\|Edit\|Write` | Auto-allow safe set; queue remainder |
| P6 | Compaction imminent | `PreCompact` | Snapshot; optional intervention |
| P7 | Idle, no explicit ask | `Notification:idle_prompt` | Lowest; screen peek |

### 11.3 Ageing

`effective_priority = base_priority − floor(age_seconds / 120)`, clamped so a P5 may rise above a fresh P3 but never above a pending P0. Age displayed on every row.

### 11.4 Deduplication

| ID | Requirement |
|---|---|
| R1 | One `pending`/`claimed` gating request per session (= RV6) |
| R2 | Identical `Notification` events within 30s for one session collapse to one request |
| R3 | On `UserPromptSubmit`, mark that session's pending non-gating requests `superseded` |

---

## 12. UI requirements

Reference implementation: `agent-console.jsx`. The prototype defines intended visual and interaction design; this section is the contract.

### 12.1 Layout

```
┌───────────────────────────────────────────────────────────────┐
│ digest strip: counts by state · capacity advisory · locality  │
├──────────────┬────────────────────────────────────────────────┤
│ board rail   │ detail pane                                     │
│              │  header: project · state · age · countdown      │
│ Pinned       │  tabs: Request | Diff | Walkthrough | Plan      │
│ Needs input  │                                                 │
│ ─ ─ ─ ─ ─    │  body: request, or artifact                     │
│ Ready for    │                                                 │
│   review     │                                                 │
│ Working      ├────────────────────────────────────────────────┤
│ Blocked      │ actions: Approve · Deny · Reply · Extend · Open │
│ Completed    │                                                 │
├──────────────┴────────────────────────────────────────────────┤
│ key legend                                    auto-advance     │
└───────────────────────────────────────────────────────────────┘
```

### 12.2 Functional requirements

| ID | Requirement |
|---|---|
| U1 | Board groups by the §11.1 vocabulary in §11.2 priority order; pinned first |
| U2 | Within a group, descending age — longest-waiting highest |
| U3 | Each row shows project, one-line summary, age, state indicator |
| U4 | `Needs input` and `Blocked` are peripherally identifiable. Respect `prefers-reduced-motion`. |
| U5 | Selecting a row loads detail without entering the session |
| U6 | **Auto-advance** on resolution; when nothing remains, say so explicitly |
| U7 | Approve / deny / reply available from action bar and keyboard |
| U8 | **P0 plan requests: Approve is disabled until the plan artifact has been opened.** Enforced, not advisory. |
| U9 | Diff artifacts are line-addressable; clicking a line opens a comment |
| U10 | Comments accumulate per session and send as **one batch**, moving the session to `Working` |
| U11 | Live countdown on every pending gating request, with **Extend** (§9.5, max 3) |
| U12 | UI renders last-known state with a clear offline indicator when the broker is down |
| U13 | Visible keyboard focus on all interactive elements |
| U14 | Usable at 1280×800; board rail collapses gracefully |
| **U15** | **`Needs input` and `Ready for review` are separate passes** with separate entry points (D2). Triage keys operate within the active pass only. |
| **U16** | **Payload-capture indicator** shown whenever a session has `capture_payloads` enabled (GV3) |

### 12.3 Keyboard map

| Key | Action |
|---|---|
| `j` / `↓` | Next row in the active pass |
| `k` / `↑` | Previous row |
| `Tab` | Switch pass — triage ⇄ review (U15) |
| `a` | Approve (gating only; disabled per U8 until plan opened) |
| `d` | Deny |
| `e` | Edit and approve — opens `updatedInput` editor |
| `i` | Reply — free text |
| `x` | **Extend deadline (+180s)** |
| `r` | Diff artifact |
| `w` | Walkthrough artifact |
| `Space` | Peek — expand summary inline |
| `s` | Snooze 10 minutes (deprioritise with visible timer, never hide) |
| `o` | Open the session's pane in iTerm2 |
| `p` | Pin / unpin |
| `Esc` | Close reply or modal |
| `Enter` | Submit active input |
| `?` | Keyboard help |

Keys must not fire while a text input has focus, except `Esc` and `Enter`.

### 12.4 Notification — load-bearing

| ID | Requirement |
|---|---|
| N1 | One digest channel. Never one notification per session. |
| N2 | At most once per 90s, and only when the actionable count increases |
| N3 | Content: counts by state plus the highest-priority item |
| N4 | Local delivery only — macOS user notification via a local binary, plus optional bell to the owning pane. No hosted push. |
| N5 | Suppressed while the console window has focus |
| N6 | Operator quiet mode suppresses notification while the board stays live |
| **N7** | **The digest is emitted by the broker and MUST function with the console closed.** This is the feature most likely to survive the operator's worst week; it is not optional. |

### 12.5 Capacity advisory — NEW

| ID | Requirement |
|---|---|
| U17 | When actionable depth (Needs input + Blocked + Ready for review) exceeds **5**, the digest strip shows an advisory: *"depth 7 — above sustainable review bandwidth."* Advisory only; never blocks. |

Rationale: the evidence puts 3–5 steerable tasks at the human ceiling. The console must not silently normalise operating above it.

---

## 13. Non-functional requirements

### 13.1 Performance

| ID | Requirement |
|---|---|
| NF1 | Auto-allow hook round-trip < 50ms |
| NF2 | UI reflects a new request within 300ms |
| NF3 | Decision reaches the blocked hook within 200ms of keypress |
| NF4 | Broker < 80MB RSS, < 1% CPU idle |

### 13.2 Reliability

| ID | Requirement |
|---|---|
| NF5 | Broker restart loses no non-terminal request; reconciliation per RV4 |
| NF6 | Console failure never blocks a session (H1) |
| NF11 | Structured logs with rotation; `dispatch doctor` verifies socket, DB, iTerm2 API, hook install, Claude Code version |

### 13.3 Security and data governance

| ID | Requirement |
|---|---|
| NF7 | Socket and DB mode 0600; HTTP bound `127.0.0.1` only |
| NF8 | **Payload capture off by default (GV2/GV3).** Redaction is explicitly not the control. |
| NF9 | No telemetry; no outbound network calls from any console component |
| NF10 | No kernel/system/network extension; no Accessibility, Input Monitoring, or Screen Recording grant |
| NF12 | 7-day retention enforced by scheduled prune (GV5) |
| NF13 | DB on encrypted volume; document backup and discovery implications (GV4/GV6) |

### 13.4 Render injection — NEW

Diff content and walkthrough text originate in files the agent read, which may include untrusted input. The console is the surface on which trust decisions are made, partly from agent-authored content.

| ID | Requirement |
|---|---|
| NF14 | All agent-derived content is escaped at render. **Never** render agent-authored HTML or Markdown-with-HTML. |
| NF15 | Diff lines render as plain text in a fixed-width container; no interpretation of embedded markup or escape sequences |
| NF16 | For any P0 decision, the **raw diff** is shown, not only a summary — a walkthrough must never be the sole basis for approving a change |
| NF17 | Walkthrough text is displayed as untrusted quoted content, visually distinguished from console chrome |
| NF18 | Content Security Policy on the served UI: no inline script, no remote origins |

---

## 14. Autonomy tiers

**The highest-leverage requirement in this document: most requests should never reach the console.**

### 14.1 Baseline permissions

Shared baseline in `~/.claude/settings.json`, per-project overrides committed to each repo. Evaluation order `deny` → `ask` → `allow`, first match wins; a `deny` cannot be overridden by a hook.

```json
{
  "permissions": {
    "allow": [
      "Read", "Edit", "Write",
      "Bash(git status)", "Bash(git diff *)", "Bash(git log *)",
      "Bash(git add *)", "Bash(git commit *)", "Bash(git branch *)",
      "Bash(npm run *)", "Bash(npm test *)", "Bash(pnpm *)",
      "Bash(pytest *)", "Bash(uv *)", "Bash(make *)",
      "Bash(ls *)", "Bash(cat *)", "Bash(rg *)", "Bash(grep *)"
    ],
    "ask": [
      "Bash(git push *)", "Bash(gh pr *)", "Bash(docker *)",
      "WebFetch", "WebSearch"
    ],
    "deny": [
      "Bash(git push --force *)", "Bash(git push -f *)",
      "Bash(rm -rf *)", "Bash(sudo *)", "Bash(curl * | *)",
      "Read(./.env)", "Read(./.env.*)", "Read(./**/secrets/**)"
    ]
  }
}
```

### 14.2 Tiers

| Tier | Behaviour | Use for |
|---|---|---|
| Supervised | Everything but reads is queued | New or risky projects |
| Standard | §14.1 baseline | Default |
| Trusted | Broad allow; only plans, questions, denies reach the queue | Mature projects with good tests |

### 14.3 Further volume reduction

Enable Claude Code's own permission automation where available on the installed version and plan (verify current defaults first). Enable macOS Bash sandboxing where supported. Add the safe-pattern pre-filter in `hook_client.py` so trivial calls never round-trip — noting it fails **closed** (§9.6).

**Acceptance target:** fewer than **10 gating requests per hour** across all sessions — measured against the §5.2 baseline, not asserted.

---

## 15. Session targeting and injection

### 15.1 Correlation

Recorded at `SessionStart`, repaired lazily: iTerm2 Python API session enumeration matched on working directory or a marker written at `SessionStart`; `tmux list-panes -a -F '#{pane_id} #{pane_current_path} #{pane_pid}'` as fallback; `TMUX_PANE` from the hook environment is the most reliable identifier when present.

### 15.2 Methods, in order

| Rank | Method | Notes |
|---|---|---|
| 1 | iTerm2 `async_send_text` | Session-addressed; avoids tmux key-encoding issues |
| 2 | `tmux send-keys -t <target> -l "<text>"` then a **separate** `Enter` | Requires the readiness poll (I2) |
| 3 | `tmux load-buffer -` + `paste-buffer -p -t <target>` | Long or multi-line; fallback when `send-keys -l` misbehaves |

### 15.3 Reliability

| ID | Requirement |
|---|---|
| I1 | Never send the submit key in the same call as the text |
| I2 | Before Enter, poll pane contents until the injected text is visible, 3s timeout — mitigates the bracketed-paste submit race |
| I3 | After Enter, verify the session left the prompt state within 2s; retry once, then surface failure |
| I4 | **Approve/deny is never implemented by keystroke injection.** Decisions travel the hook return value. |
| I5 | Never inject arrow keys to answer selection lists. Use the gating hook or hand over the pane. |
| I6 | Never use AppleScript/System Events (violates C6) |

### 15.4 Jump to pane

`o` activates the owning iTerm2 session and, with tmux, selects and optionally zooms the pane. Always available.

---

## 16. Artifact generation

The differentiator (§3.1). Built by the broker on `Stop`, cached by git HEAD and tree hash. **Built in defensibility order:**

### 16.1 Diff artifact — differentiator 1, build first

- `git -C <cwd> diff`, `diff --cached`, `status --porcelain`, `diff --stat`.
- Where a session's base commit is known, prefer `git diff <base>..HEAD` plus working-tree changes so committed and uncommitted work are both covered.
- Per-file grouping, hunk headers, **stable line indices** so comments anchor correctly across rebuilds.
- Above 2,000 changed lines: file summaries with expand-on-demand per file.
- Rendered per NF15 and NF16.

### 16.2 Batched comments — differentiator 2

Capture per line, accumulate, send as one message via §15.2 rank 1. Session moves to `Working`.

### 16.3 Digest — differentiator 3

Per §12.4, emitted by the broker (N7).

### 16.4 Walkthrough — differentiator 4, build last or not at all

Prose narrative of what the agent did and why, from the transcript at `transcript_path` (supplied by the hook; never reconstruct). The transcript is append-only JSONL containing user turns, assistant messages, `tool_use`/`tool_result` entries, thinking blocks, timestamps, token usage, and parent linkage. Extract for the current turn range: original instruction, significant tool actions, explained decisions, files touched. **Template-based and deterministic in v1** (D4). Displayed as untrusted quoted content (NF17), never the sole basis for a P0 approval (NF16).

Most likely of the four to be commoditised by a model-generated summary in the product itself — hence last.

### 16.5 Staleness

Marked `stale` when git HEAD or tree hash changes after build; visibly flagged; rebuilt on demand.

---

## 17. Kill criteria and maintenance

Written now, not later, because sunk cost otherwise decides.

### 17.1 Kill criteria

| Condition | Action |
|---|---|
| Anthropic ships cross-session diff review or per-session artifact generation before **1 November 2026** | Stop. Write up the learning. |
| Step 3 clears its gate (prompts < 10/hr **and** speculative pane visits stop) | Stop at step 4. Do not build the artifact layer or the gate. |
| Objective declared as **C** in §1.4 | Stop after step 4 plus write-up. |
| ABAB periods (§5.4) show no improvement outside noise | Stop. Record the negative result. |

### 17.2 Maintenance budget

| ID | Policy |
|---|---|
| M1 | Budget is **2 hours per month**. Tracked. |
| M2 | If a Claude Code upgrade breaks it and it is not repaired within one week, it is **turned off deliberately** and the reason logged in `DECISIONS.md` |
| M3 | Abandonment-by-neglect is not permitted. Every cessation is a recorded decision. |
| M4 | `dispatch doctor` runs on Claude Code binary change and surfaces breakage as a UI banner (V3) so M2's clock starts visibly |

---

## 18. Revised build sequence

Reordered per Lindqvist P0 — differentiator before commodity — and gated per Ellery P0 and Okonkwo P0.

| Step | What | Days | Gate to proceed |
|---|---|---|---|
| **0** | **Declare the objective (§1.4) in writing** | 0.5 | Objective recorded. If **C** → jump to step 4, then stop. |
| **1** | **Passive instrumentation only** (§5.1). No permission changes, no UI, no gating. | 2 | Baseline written to `baseline.json` and committed (§5.2) |
| **2** | **`dispatch doctor --hooks`** (§10) | 1 | Every assumed hook behaviour confirmed on the installed version |
| **3** | **Permission tuning (§14) + Wizard-of-Oz board** — a shell loop printing `claude agents --json` into a pane | 2 | **HARD STOP GATE: if prompts < 10/hr and speculative pane visits stop → STOP. Write it up. Do not build steps 4–6.** |
| **4** | **Thin read-only board** consuming `claude agents --json`, plus the **broker-emitted digest** (N7) | 2 | Digest verified working with the console closed |
| **5** | **Artifact layer** — diff review first (16.1), then batched comments (16.2) | 3 | Manual Experiment 3 showed an artifact caught something the pane did not |
| **6** | **Gating hook** — rendezvous per §9.7, fail paths per §9.6 | 3 | **BLOCKED until §4.1 data classification complete and §4.2 IT notification recorded** |
| **7** | Write-up and internal demo | 1 | — |

Two cheapest steps now positioned to make steps 5–6 unnecessary. The most compliance-sensitive component is last, where it can be cut without loss.

**Out of scope for v1:** voice input; local-model summarisation; Agent Teams integration; worktree management; anything requiring a hosted service; a second device.

---

## 19. Testing

| Area | Approach |
|---|---|
| Hook contract | Golden files: recorded stdin → asserted stdout JSON and exit code |
| Fail-open | Kill the broker mid-session; assert every gating hook returns `ask` within 500ms and sessions continue |
| **Fail-closed** | Corrupt the safe-pattern list; assert the pre-filter stops auto-allowing (§9.6) |
| **Rendezvous** | 10 simultaneous gating requests; correct decision to correct hook, zero cross-talk, zero orphans (RV7). Kill and restart broker mid-flight; assert RV4 reconciliation. |
| Injection | 200 strings including multi-line and unicode against a scratch session; exact receipt, single submission |
| **Render injection** | Diff and walkthrough fixtures containing HTML, ANSI escapes, and control characters; assert inert rendering (NF14–NF15) |
| Ageing / priority | Unit tests over synthetic queues, including starvation |
| Artifact builder | Fixture repos and transcripts; stable line indices across rebuilds |
| **Retention** | Assert rows past `expires_at` are pruned and payloads are absent when `capture_payloads` is 0 |
| Version drift | `dispatch doctor --hooks` after each upgrade |
| Notification | No more than one digest per 90s under a burst of 50 events; digest fires with UI closed |

---

## 20. Decisions

Resolved from v1.0's open list, plus new ones from the panel.

| # | Decision | Resolution |
|---|---|---|
| D1 | UI technology | **Option A (localhost web)**, with §13.4 escaping mandatory. Switch to Textual if escaping proves burdensome — it eliminates the class. |
| D2 | Shared triage flow for review? | **Separate passes** (U15). Mixing tempos encourages rushing reviews. |
| D3 | Plan approval without opening the diff? | **No.** Enforced by U8 and NF16. |
| D4 | Walkthrough generation | **Template-based v1.** Build last (16.4); may be cut. |
| D5 | Snooze semantics | **Deprioritise with visible timer.** Never hide. |
| D6 | Concurrency cap | **Advisory only** at depth > 5 (U17). |
| **D7** | Gating timeout | **180s with up to 3 × 180s extensions** (§9.5) |
| **D8** | Payload capture | **Off by default, opt-in per project, indicated in UI** (GV3, U16) |
| **D9** | Where the digest lives | **Broker, not UI** (N7) |
| **D10** | Build order | **Differentiator before commodity** (§18) |

---

## 21. Appendix A — File layout

```
~/.dispatch/
  dispatch.db                 SQLite WAL, mode 0600, encrypted volume
  baseline.json               §5.2 — never overwritten
  broker.sock                 UDS, mode 0600
  config.toml                 projects, tiers, safe-pattern list, ports, capture flags
  logs/                       broker.log, hooks.log (rotated)
  artifacts/                  spilled artifact bodies

~/src/dispatch/
  pyproject.toml
  DECISIONS.md                M2/M3 decision log
  dispatch/
    hook_client.py            zero-dependency fast path
    broker/
      server.py               UDS + HTTP/SSE
      store.py                SQLite access
      rendezvous.py           §9.7 state machine, reconciliation, heartbeat
      priority.py             taxonomy, ageing
      metrics.py              §5 measurement, ABAB phase tagging
      retention.py            GV5 prune
      artifacts/{diff,walkthrough,plan}.py
      integrations/{iterm,tmux,claude_agents}.py
      notify.py               digest scheduler — runs headless
      doctor.py               §10
    ui/                       React app, built to ui/dist
  scripts/
    install-hooks.py
    com.local.dispatch.plist
```

## 22. Appendix B — Dependencies

**Python:** `fastapi`, `uvicorn`, `iterm2`, `pydantic`, `typer`, `rich`, `watchfiles`. SQLite via stdlib. `textual` only under D1 fallback.

**Node (build-time only):** `react`, `vite`, `tailwindcss`, `lucide-react`.

**System:** iTerm2 with the Python API enabled (Settings → General → Magic → *Enable Python API*); tmux; git; a local notification binary such as `terminal-notifier`.

## 23. Appendix C — Hook installation block

`scripts/install-hooks.py` merges the following into `~/.claude/settings.json` without clobbering existing hooks. Note the 180s timeout (D7).

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "ExitPlanMode|AskUserQuestion",
        "hooks": [{ "type": "command", "command": "python3 ~/src/dispatch/dispatch/hook_client.py --gate", "timeout": 180 }] },
      { "matcher": "Bash|Edit|Write",
        "hooks": [{ "type": "command", "command": "python3 ~/src/dispatch/dispatch/hook_client.py --gate", "timeout": 180 }] }
    ],
    "Stop":               [{ "hooks": [{ "type": "command", "command": "python3 ~/src/dispatch/dispatch/hook_client.py --event stop" }] }],
    "SubagentStop":       [{ "hooks": [{ "type": "command", "command": "python3 ~/src/dispatch/dispatch/hook_client.py --event subagent_stop" }] }],
    "PostToolUseFailure": [{ "hooks": [{ "type": "command", "command": "python3 ~/src/dispatch/dispatch/hook_client.py --event tool_failure" }] }],
    "PreCompact":         [{ "hooks": [{ "type": "command", "command": "python3 ~/src/dispatch/dispatch/hook_client.py --event pre_compact" }] }],
    "SessionStart":       [{ "hooks": [{ "type": "command", "command": "python3 ~/src/dispatch/dispatch/hook_client.py --event session_start" }] }],
    "SessionEnd":         [{ "hooks": [{ "type": "command", "command": "python3 ~/src/dispatch/dispatch/hook_client.py --event session_end" }] }],
    "UserPromptSubmit":   [{ "hooks": [{ "type": "command", "command": "python3 ~/src/dispatch/dispatch/hook_client.py --event user_prompt" }] }],
    "Notification": [
      { "matcher": "permission_prompt|idle_prompt",
        "hooks": [{ "type": "command", "command": "python3 ~/src/dispatch/dispatch/hook_client.py --event notification" }] }
    ]
  }
}
```

---

## 24. Verification note

Version-specific details in §9, §10, and §14 — hook event names, matcher strings, payload fields, decision semantics, timeout behaviour, the reported defects, and Claude Code's permission-automation defaults — were assembled from documentation and issue reports current to roughly August 2026, plus a research pass in the conversation that produced this document. Claude Code's hook surface moves quickly.

**§10 is a gate, not a formality.** Run `dispatch doctor --hooks` against the installed version before depending on any behaviour described here, and after every upgrade.

# Lattice Claude Console — Project Understanding & Scope

> Status: **v1 IMPLEMENTED** — 2026-08-10. Kamran resolved WS0 by decision: personal
> tool, local use, build it completely ("better than iTerm2 alone or claude agents").
> The §0 validation gates were superseded by that directive; the panel's technical
> mandates (security minimums, inbox-first ordering, adapter isolation, graceful
> degradation) are all implemented. See `README.md` for what shipped.
> Panel review retained below for the record (see `docs/panel-review-2026-08-10.md`).
> This project has no prior spec. Everything below is synthesized from observable evidence;
> assumptions are explicitly flagged and need validation with Kamran before build.

## 0. Panel-mandated gates (do these before anything in §6)

1. **First-party overlap audit (~1 hr)** — enumerate what current Claude Code CLI / web / desktop already provide (FleetView agent dispatch, `/workflows` progress, background-job notifications, session resume/views). Write down the *specific delta* this console adds. If the delta is thin, this becomes a feature request to Anthropic, not a project.
2. **Two sub-day kill experiments before any console code**:
   - *Missed approvals*: Notification/Stop hook → phone push (e.g., ntfy/Pushover). ~20 lines of config.
   - *Cost attribution*: enable Claude Code OpenTelemetry metrics export → per-project/per-client cost sheet.
   If these two hacks kill the top pains, **stop — the console shouldn't exist**, and that outcome is a success.
3. **Success / kill criteria** — "If I'm not opening it daily by week 3 of use, archive the repo." Written before build, not after.
4. **Security minimums promoted to v1 requirements** (not principles): bind 127.0.0.1, auth token even locally (DNS-rebinding/CSRF hit unauthenticated localhost APIs), no persistent transcript index without an explicit decision.

## 1. Known facts (evidence)

- **Repo**: `ai-lattice/lattice-claude-console` — private, freshly created 2026-08-10, contains only a LICENSE. No description, no issues, no README.
- **Org context**: AI Lattice's flagship is **Kastra** ("Kernel Agent Supervisor — secure multi-tenant AI agent platform with Work Acceleration Engine"): PostgreSQL RLS tenant isolation, hybrid local/cloud LLM routing, human-in-the-loop approvals, MCP governance, per-tenant token metering. Sibling repos: `kasassist` (predecessor), `stock-trading`.
- **Operator context**: Kamran runs **15+ concurrent Claude Code projects** (`~/.claude/projects/` shows dormakaba client work across ~8 repos, kastra, janus, openassist, stock-trading, strategy-service, Rookwise, sip-sure…), with heavy use of background jobs, scheduled routines, subagents, and a large plugin/skill stack.
- **No spec found** in email, project memory, or sibling-repo docs (Kastra's roadmap/architecture never mention a console or Claude Code).

## 2. Product hypothesis (ASSUMPTION — validate with Kamran)

**A "mission control" console for Claude Code activity across all of Kamran's projects**: a single pane of glass to observe, steer, and account for the fleet of Claude Code sessions, background jobs, scheduled routines, and their outputs.

Reasoning: the name (`claude-console`), the org (ai-lattice), and the observed pain (a solo operator juggling 15+ Claude-Code-driven projects with no cross-project visibility) all point the same direction. Kastra covers *platform agents for organizations*; nothing in the portfolio covers *the operator's own Claude Code fleet*.

### Explicitly uncertain
- **Personal tool vs. product**: is this an internal tool for Kamran, or a future AI Lattice product (e.g., packaged for consultants/teams who run Claude Code at scale)?
- **Read-only monitor vs. control plane**: dashboards only, or also launch/steer/stop sessions?
- **Local vs. hosted**: local web app reading `~/.claude`, or a hosted console fed by agents?
- **Relationship to Kastra**: standalone, or a future module of the Kastra dashboard?

## 3. Users & jobs-to-be-done

Primary persona (v1): **the solo AI-native operator** (Kamran) running many concurrent Claude Code sessions across client and product work.

| Job | Today's pain | Enabled in console |
|---|---|---|
| Know what's running, stuck, waiting-on-me, or done across all projects | Must open each terminal/session individually | ✅ Fleet view — working / **stalled** (busy, no transcript movement 10 min) / waiting / idle / done / ended |
| Review outputs and unblock sessions waiting for input | Notifications are scattered; approvals get missed | ✅ Inbox + session **composer**: send a message from the console (`claude --bg --resume` dispatch, auto-follows the fork) |
| Track token spend per project / per client | No cross-project cost roll-up (matters for client billing, e.g., dormakaba) | ✅ Costs view, month filter, CSV export; fork-aware global request dedup |
| Re-run and schedule routines; see routine history | Cron/scheduled agents lack a unified history view | ✅ Jobs view with run-history timelines + resume/re-dispatch. (Cloud-scheduled routines aren't stored locally — out of local scope) |
| Find past sessions, decisions, and artifacts | Transcript JSONL is unsearchable in practice | ✅ Search view — ripgrep full-text across all transcripts incl. subagents |

Secondary persona (later, if productized): small teams / consultancies running Claude Code fleets.

## 4. Candidate MVP scope (reordered per panel: one thin slice, not five)

**Panel consensus: the hero feature is the "waiting on me" inbox — interruption routing, not fleet visibility.** A dashboard the operator must remember to poll recreates the original problem.

1. **"Waiting on me" inbox** *(the thin slice — only if the hook-experiment in §0 proves insufficient)* — sessions blocked on input/approval, with enough context to answer from anywhere.
2. **Per-client cost/usage export** — a month-end *report* (sessions/tokens/cost per project → client) suitable for invoice attachment; a dashboard is secondary. *(Only if the OTel experiment in §0 proves insufficient.)*
3. **Fleet view** — projects/sessions with status (running / waiting / idle / done), driven by hook events, not mtime inference (false "stuck" alerts kill trust).
4. **Session detail** — timeline: tasks, tool activity summary, artifacts, background-job final reports.
5. **Jobs & routines** — background jobs and scheduled routines with status and history.
6. *(v2)* — full-text transcript/artifact search ("what did I decide about X three weeks ago" — sleeper feature, revisit early).
7. *(v2, control plane)* — launch/steer/stop/approve from the UI. **Note: this makes the console a remote-code-execution surface by design; requires its own security review when proposed.**

## 5. Architecture sketch (revised per panel: official surfaces FIRST)

- **Data-source priority (inverted from first draft)**:
  1. **Official surfaces are primary**: Claude Code hooks (Stop, Notification, TaskCompleted, SessionStart) as the event backbone; OpenTelemetry metrics export for all token/cost data; headless mode / CLI JSON output where applicable.
  2. **`~/.claude` scraping is last resort**, only for residue the official surfaces can't provide, isolated behind an adapter that tags data with the Claude Code version that wrote it (drift tests are impossible without version tagging).
- **Local-first**: no cloud dependency in v1 — client data (dormakaba) stays on-machine. Server binds 127.0.0.1 with a local auth token (see §0.4).
- **Sustainability rule**: minimize scraped surface area; on format drift, degrade gracefully (partial views) rather than break. A solo-maintained tool that breaks monthly is abandoned by month two.
- Likely stack: TypeScript end-to-end (Node/Bun server + React/Vite) — but validate first whether a TUI or generated static report meets the v1 need without a resident server.

## 6. Everything we need to do (workstreams)

**WS0 — Product definition validation** *(gate for everything else — includes all four panel gates in §0)*
- Run the first-party overlap audit and both kill experiments (§0.1–0.2).
- Confirm/correct the product hypothesis and the four uncertainty axes in §2 with Kamran.
- Write success/kill criteria (§0.3). Pick the v1 persona and the top 2 jobs from §3.

**WS1 — Discovery spike (data sources)**
- Map official surfaces first: hook events, OTel metrics fields, headless/CLI JSON output — what fraction of §4 do they cover?
- Only then inventory the `~/.claude` residue needed, with per-source stability risk and version tagging.

**WS2 — Design**
- Information architecture: Fleet → Project → Session → Task drill-down; cost view; "waiting on me" inbox as the likely hero screen.
- Low-fi wireframes before any UI code.

**WS3 — Build MVP (read-only)**
- Adapter layer over `~/.claude` sources → local API → fleet/session/jobs/cost views.
- Ship the thinnest end-to-end slice first (fleet view with live status), then iterate.

**WS4 — Security & privacy**
- Transcripts contain client-confidential data → local-only by default, no telemetry out.
- v1 requirements (per panel, not optional): 127.0.0.1 bind + local auth token; no persistent transcript index without explicit decision. A console *concentrates* previously-scattered sensitive data into one queryable surface — price that in.
- Concrete task (not just principle): secrets/PII detection & redaction pass for anything displayed or exported; treat "check the fleet from my phone" (§8 Q3) as a threat-model change requiring its own review.

**WS5 — Ops & sustainability**
- Packaging (single command to run), versioning against Claude Code releases, smoke tests that detect `~/.claude` format drift.

**WS6 — Later / strategic**
- Control-plane features (launch/steer/approve), transcript search, multi-user story, and the Kastra-integration decision.

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `~/.claude` format drift breaks ingestion | High | Official surfaces primary (§5); tiny scraped surface; version tagging + drift smoke tests (WS5) |
| Anthropic first-party overlap (FleetView, /workflows, notifications, web/desktop session views **already exist**) | **High** (panel upgraded from Medium) | §0.1 audit is a hard gate; the console lives or dies on a written delta |
| Scope creep toward rebuilding Kastra's dashboard | Medium | WS0 gate; console = *operator's own fleet*, Kastra = *org's agent platform* |
| Solo-dev bandwidth vs. many active projects | Medium | Thin-slice MVP; console must pay for itself in saved attention quickly |
| Client confidentiality (dormakaba data in transcripts) | High | WS4 local-only default |

## 8. Open questions for Kamran (WS0 input)

1. Personal tool or future product?
2. Read-only first, or is control (launch/steer/approve) the actual point?
3. Local-only acceptable, or do you want to check the fleet from your phone (→ hosted/tunnel implications)?
4. Which single pain, if solved, makes this worth building — visibility, cost attribution, missed approvals, or search?
5. Should this eventually merge into Kastra's dashboard, or stay deliberately separate?

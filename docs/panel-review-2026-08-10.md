# Stakeholder Panel Review — Project Understanding & Scope

**Date**: 2026-08-10 · **Work product**: `docs/project-understanding.md` (concept stage)
**Verdict**: **NEEDS WORK** — sound scoping document; four blocking actions before any build.
**Stakes**: low capital risk, high opportunity-cost risk (time here competes with billable client work and Kastra).

## Panel

| Panelist | Lens | Rating |
|---|---|---|
| Priya Raghavan — Principal Engineer, Dev Tooling (14 YOE) | Technical feasibility, data-source strategy | 🟡 |
| Marcus Feld — Product Strategy Partner, ex-founder (18 YOE) | Viability, validation path, opportunity cost | 🔴 |
| Sofia Alvarez — Security & Privacy Lead (12 YOE) | Data concentration, threat model | 🟡 |
| Dan Okafor — DevEx / Operations Pragmatist (15 YOE) | Maintenance burden, sustainability | 🟡 |
| Jules Tan — Skeptical End User, solo AI consultant (10 YOE) | Daily-use reality, actual pains | 🟡 |

## Key findings by panelist

**Priya (🟡)** — P0: data-source priority is backwards. Official surfaces (hooks as event backbone, OpenTelemetry metrics for cost, headless/CLI JSON) must be primary; `~/.claude` scraping only for residue, behind an adapter with Claude Code version tagging. P1: session status must come from hook events, not mtime inference — false "stuck" alerts destroy trust. P2: validate whether a TUI/static report beats a resident server for v1.

**Marcus (🔴)** — P0 #1: first-party overlap understated — Claude Code already ships FleetView agent dispatch, `/workflows` progress, background-job notifications, and web/desktop session views. A 1-hour audit producing a *written delta* is a hard gate; a thin delta means "feature request to Anthropic," not a project. P0 #2: the cheapest tests are missing — (a) Notification/Stop hook → phone push kills the missed-approvals pain in ~20 lines; (b) OTel export → cost sheet kills the invoicing pain. Run both *before* any console code; if they suffice, stop — that's a success. P0 #3: no success/kill criteria ("opened daily by week 3 or archive"). P1: default to personal tool; there is zero customer signal for productization.

**Sofia (🟡)** — P0: a console *concentrates* previously-scattered sensitive data (dormakaba client material, secrets echoed in tool output) into one queryable surface; even local-only v1 needs 127.0.0.1 bind + local auth token (DNS-rebinding/CSRF reach unauthenticated localhost APIs) and no persistent transcript index without an explicit decision. P1: "check fleet from phone" is the highest-consequence open question — a threat-model change, not a casual preference; secrets redaction must be a workstream task, not a principle. P2: the v2 control plane is remote code execution by design → own review when proposed.

**Dan (🟡)** — P1: maintenance is the unbudgeted real cost; a solo-maintained tool that breaks on Claude Code releases is abandoned by month two → minimize scraped surface, degrade gracefully on drift. P1: "thin slice" and a five-item MVP contradict each other — pick one item. P2: single-command run + survives restart (launchd) belongs in scope now.

**Jules (🟡)** — P1: "I don't have a visibility problem; I have an interruption-routing problem." A dashboard I must poll recreates the problem; the *waiting-on-me inbox* is the hero feature, fleet view will be ignored within a week. P1: the invoicing job needs a per-client month-end *export/report*, not a dashboard. P2: transcript search is the sleeper feature — don't let it languish in v2.

## Consensus

| Dimension | Rating | Blocking? |
|---|---|---|
| Evidence & structure of the doc | 🟢 | No |
| Hypothesis validation path | 🔴 | Yes |
| Data-source strategy | 🟡 | Yes |
| MVP scope & ordering | 🟡 | Yes |
| Security & privacy | 🟡 | Yes |
| Operational sustainability | 🟡 | No |

## Required actions (P0, deduplicated) — now §0 of the understanding doc

1. First-party overlap audit (~1 hr) with a written delta. *(Marcus)*
2. Two sub-day kill experiments before any console code: hook→push for approvals; OTel→cost export for invoicing. *(Marcus, Jules, Priya)*
3. Invert data-source priority: official surfaces primary, scraping last. *(Priya, Dan)*
4. Success/kill criteria written before build; localhost auth + no-unencrypted-index as v1 requirements. *(Marcus, Sofia)*

All four actions have been incorporated back into `docs/project-understanding.md` (§0, §4, §5, WS0/WS1/WS4, risk table).

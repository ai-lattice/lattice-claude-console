# Dispatch — JTBD Analysis & Panel Review

**Work product under assessment:** a local supervision console for 8–10 concurrent Claude Code sessions (see `REQUIREMENTS.md` v1.0 and the `agent-console.jsx` prototype).

| | |
|---|---|
| Date | 9 August 2026 |
| Stage | Concept validated, spec drafted, no code written |
| Assessor | jtbd-assessor → panel-review |
| Verdict | **Needs work — build less, in a different order, measure first** |

---

# Part 1 — JTBD Analysis

## Stage 1: The North Star (Outcome)

**Process note first.** This concept arrived solution-first. Nine rounds of investigation covered surfaces — iPads, Stream Decks, macropads, MIDI grids, tmux layouts, consoles — before any outcome was stated. That is precisely the product myopia this framework exists to interrupt.

**Candidate desired outcome:** ship the same or more working software across 8–10 projects while spending less of the day in decision-latency.

Operationalised:

| | |
|---|---|
| **Behaviour change** | Time from *agent blocked* to *agent unblocked* falls from minutes-or-hours to under 2 minutes |
| **Primary metric** | Agent idle-waiting-on-human time per day, as a share of total agent runtime |
| **Counter-metric** | Decision quality holds — no increase in approved-then-abandoned plans or reverted commits |

The counter-metric is not decoration. A console that makes the operator a faster rubber stamp is a net negative outcome.

**Unresolved and blocking:** which business objective does this serve?

1. Personal throughput.
2. A reference implementation for how the organisation supervises agents at scale.
3. Evidence of frontier fluency for an internal or external audience.

These lead to materially different builds. (1) justifies the full spec. (2) justifies documentation and generalisation over polish. (3) justifies a v1 plus a written account and nothing more. **This must be answered before Phase 1.**

## Stage 2: The Job-to-be-Done

Job performer and buyer are the same individual. n = 1, with consequences in Stage 4.

**Functional job statement**

> As a technical operator running many autonomous agents, when several of them stop and wait on me at unpredictable times, I want to find and resolve whatever is blocking progress with minimal search and minimal context loss, so that agent capacity isn't idled by my attention being elsewhere.

**Emotional job:** relief from the low-grade dread of *something is stalled and I don't know which one.* This is an anxiety job. Anxiety jobs are frequently satisfied by **visibility alone**, often more than by faster action. That predicts the board (spec Phase 2) delivers most of the felt value and the gating mechanism (Phase 3) much less.

**Social job:** to be credibly the person who operates at the frontier of this, from direct experience. Legitimate, and probably load-bearing given the operator's trajectory. But it is served by *having built and run* this, and by being able to explain what was learned — not by the console's steady-state ergonomics.

**Fired on adoption:** `Ctrl+Z`; the habit of visiting panes speculatively to check on them.

**Not fired:** the panes themselves, `claude agents`, or operator judgement on plans.

## Stage 3: The Opportunity

**Opportunity statement**

> Help an operator of many parallel agents eliminate the search cost of finding blocked work, so that agent capacity isn't idled by human attention latency.

**Solution-agnostic test — passed.** At least four distinct approaches address this job:

1. Aggregate and triage the requests (the console).
2. **Eliminate the requests** — permission configuration, sandboxing, auto-allow.
3. Reduce concurrency to what one person can hold.
4. Change the work unit — batched asynchronous review of finished artifacts instead of live supervision.

Nine rounds went to approach 1. Approach 2 is Phase 0 of the spec, is dramatically cheaper, and attacks the same job.

| Dimension | Rating | Reasoning |
|---|---|---|
| Importance | **High** | Idled agent capacity is the direct cost; felt daily |
| Satisfaction today | **Medium** | `claude agents` already provides a state-grouped fleet table *and* peek-and-reply. Incumbent satisfaction is not zero. |
| Attractiveness | **Low as a market / High as an n=1 job** | High frequency; small but fast-growing population of operators running 8–10 concurrent agents |

Medium incumbent satisfaction is the single most consequential number in this analysis. When the incumbent half-works and its vendor is actively improving it, the return on a bespoke build compresses sharply.

## Stage 4: Real / Win / Worth

**Real — Yes.** Revealed preference over nine rounds of investigation. Persistent, not episodic. Evidence is n=1, but the operator is the user.

**Win — Partial and narrowing.** The defensible advantages are exactly four: cross-project diff review, durable walkthrough artifacts, batched asynchronous comments, and a single notification digest. There is no advantage on fleet overview or peek-and-reply, which Anthropic ships and improves continuously. **The defensible core is the artifact layer, not the queue.**

**Worth — No as a product; conditionally yes as internal tooling.** Market TAM is negligible and well-contested (Anthropic, Antigravity, GitHub Agent HQ, cmux, HumanLayer, ccmanager). As tooling the calculation is ~10 engineer-days against recovered agent capacity plus organisational learning — which clears, *provided the build stops at v1*. See panel findings for a material correction to this cost estimate.

**Product hypothesis:** if blocked-agent requests are aggregated into one prioritised surface with in-place resolution, time-to-unblock falls below 2 minutes with no fall in decision quality.

**Value hypothesis:** if every blocked agent can be seen and resolved from one surface, speculative pane-visiting stops — measurable as pane switches per hour.

## Stage 5: Risks & Experiments

| Risk type | Assumption that must be true | Confidence | Impact if wrong |
|---|---|---|---|
| Value | Search cost is the bottleneck, not review bandwidth | **Low** | **Severe** |
| Value | Permission tuning alone won't resolve it | **Low** | High |
| Usability | The operator will live in a second window rather than reverting to panes | Medium | High |
| Technical | Blocking hooks are reliable enough to gate 10 concurrent sessions | Medium | **Severe** |
| Business | Claude Code won't ship this natively within ~6 months | **Low** | Medium |

**Experiment 1 — Phase 0 in isolation (2 days).** Apply permission allow-lists and sandboxing. Measure gating prompts per hour and rough time-to-unblock. *Success:* under 10 prompts/hour and the dread subsides → **stop, no console needed.** *Failure:* still hunting → proceed.

**Experiment 2 — Wizard-of-Oz the board (1 day).** A shell loop printing `claude agents --json` into a dedicated pane every 5 seconds. No UI, no hooks, no broker. *Success:* speculative pane-visiting stops → the board is the value; build Phase 2 and consider stopping. *Failure:* seeing without acting is insufficient → the gate is justified.

**Experiment 3 — Artifact value, manual (half a day).** For three sessions, hand-write the walkthrough from the transcript and read the diff before deciding. *Success:* catches something otherwise missed → the artifact layer is the real prize. *Failure:* diff alone sufficed → cut walkthrough generation.

---

# Part 2 — Panel Review

## Context

- **Scope:** the JTBD analysis above, `REQUIREMENTS.md` v1.0, and the interaction prototype. Out of scope: Claude Code itself, model selection, the operator's project portfolio.
- **Stage:** pre-code. Nothing is committed. Cheapest possible moment to change direction.
- **Constraints:** MDM-managed work machine; local-only; no cloud or relay; single operator; native Claude Code CLI retained.
- **Stakes if it fails:** ~10 engineer-days of senior attention, an abandoned tool, and — per the compliance panelist — a precedent-setting change to a managed development environment.

## Panelists

| Panelist | Role | Lens |
|---|---|---|
| **Priya Raghunathan** | Staff Engineer, Developer Tooling (14 yrs) | Will this actually work under load, and who maintains it? |
| **Marcus Ellery** | Director, Engineering Productivity Research (16 yrs) | Is the improvement measurable, or merely felt? |
| **Dana Okonkwo** | Head of Endpoint Security & Compliance (18 yrs) | What does this do to a managed machine and its data? |
| **Sasha Lindqvist** | VP Product, Developer Platforms (12 yrs) | Build-vs-buy, competitive convergence, when to stop |
| **Reuben Adeyemi** | Chief of Staff to a CTO (11 yrs) | Is this the best use of this specific person's hours? |
| **"Kamran, three months from now"** | Skeptical end user | Will I still be using this? |

---

### Priya Raghunathan — Staff Engineer, Developer Tooling
**Rating: 🟡 CONCERNS**

**P0 — Blockers**

*The blocking rendezvous is the highest-risk component in the system and the spec treats it as a Phase 3 implementation detail.* Ten concurrent sessions, each capable of holding a tool call open for 900 seconds, coordinating through a single-writer SQLite database and one Unix socket. The spec gives me a `rendezvous` column and a module name. It does not give me a state machine, orphan reaping, or a story for what happens when the broker restarts holding twelve in-flight rendezvous. I have shipped this pattern twice. Both times the first production incident was an orphaned waiter, not a crash.

Required before code: an explicit state machine for a request (`pending → claimed → answered | expired | orphaned`), a broker-startup reconciliation pass that resolves every `pending` row older than its timeout, and a heartbeat so a hook can detect a dead broker mid-wait rather than only at connect time.

*`dispatch doctor --hooks` is in Phase 5. It must be in Phase 1.* Section 14 correctly identifies that this design rests on version-specific hook behaviour, several instances of which are documented as defective. Then it schedules the verification tool last. You will spend Phases 1–4 building on assumptions you had a tool to check on day two.

**P1 — High priority**

The 900-second timeout is a liability, not a convenience. A forgotten pending request holds a tool call for fifteen minutes, during which the session looks alive and is not. Combine that with the operator stepping into a meeting and you have silently frozen agents. Recommend 180 seconds with an explicit in-UI extend action, plus a hard rule that any expiry emits `ask` so the pane's own prompt takes over.

Render injection is unaddressed. Diff content and walkthrough text originate in files the agent read, which may include untrusted input. You are rendering that into a web UI. Section 9 says nothing about escaping. This is a straightforward XSS in your own console.

**P2 — Recommendations**

Option B (Textual) eliminates the browser process, the SSE transport, and the entire render-injection class. The spec chose Option A partly to match the prototype — that is an aesthetic reason driving an architectural decision. Worth revisiting.

**Verdict:** the architecture is sound in shape and under-specified exactly where it will hurt. Fix the rendezvous spec and move `doctor` forward, and I would approve.

---

### Marcus Ellery — Director, Engineering Productivity Research
**Rating: 🔴 CRITICAL**

**P0 — Blockers**

*There is no baseline, so no finding will be falsifiable.* The spec sets an acceptance target of fewer than 10 gating requests per hour. Against what? Nobody has measured the current rate. Phase 0's acceptance criterion says "measured volume drops materially" and Phase 1's says a baseline is "recorded" — after Phase 0 has already changed the system. You will have altered the variable before measuring it.

Instrument first. Two days of passive logging — hook events by type, per session, with timestamps — before touching a single permission rule. That log is also 80% of Phase 1's data layer, so this costs nearly nothing and makes everything downstream measurable.

*The counter-metric is named and not operationalised.* "Decision quality holds" is unmeasurable as written. Concretely: sample 10% of approvals for retrospective review; track plans approved and subsequently abandoned; track commits reverted within 48 hours; track mean time-on-decision for P0 plan approvals specifically. If time-on-decision for plans falls after the console ships, that is the rubber-stamp failure mode appearing, and you want to see it.

**P1 — High priority**

n=1 with no control period means novelty effects and regression to the mean will present as gains. You will feel faster in week one regardless of whether you are. Recommend an ABAB design: two weeks with the console, two weeks with it disabled, repeated. Crude, but it is the difference between evidence and vibes.

The emotional job — relief from dread — is the outcome most likely to be genuinely achieved and the one you have no measure for. Add a daily one-question self-report. It sounds soft; it is the only instrument that will capture the effect the JTBD analysis predicts is largest.

**P2 — Recommendations**

Log agent idle-waiting time from the transcript timestamps rather than from the console. Console-derived metrics will be biased by console usage.

**Verdict:** the plan as written cannot tell success from placebo. Two days of instrumentation before Phase 0 fixes this and is nearly free. Blocking until then.

---

### Dana Okonkwo — Head of Endpoint Security & Compliance
**Rating: 🔴 CRITICAL**

**P0 — Blockers**

*You are inserting an unreviewed interception layer into the tool-execution path on a managed corporate endpoint.* Let me state this plainly, because the spec frames MDM only as a constraint on what can be installed. A `PreToolUse` hook that sees, and can modify, every tool call made by an AI agent operating on company source code is a security control. It has no threat model, no change review, and no owner but you. That the machine's admin rights permit it is not the question.

The precedent matters more than the artifact. The operator is SVP of AI & Operations. Whatever pattern he establishes on his own machine becomes the pattern others cite. If this is going to exist, it should exist with an IT and security conversation attached — which he is unusually well placed to have quickly and to shape into policy. Twenty minutes of that conversation converts this from shadow tooling into a sanctioned reference implementation, which is also the outcome the JTBD's objective (2) wants.

*The `event_log` table is a new, unclassified corporate data store.* It persists `tool_input` — which will contain source code, file paths, command lines, and, notwithstanding the redaction requirement in NF8, credentials. Thirty-day retention, mode 0600, unencrypted SQLite in the home directory, backed up by whatever backs up that machine. NF8 says "redact before write" in nine words. Redaction of secrets from arbitrary tool input is a known-hard problem and cannot be a footnote.

Required: classify the data; default to storing metadata and hashes rather than payloads; make payload capture opt-in per project and off by default; encrypt at rest or place the DB on an encrypted volume; shorten retention to 7 days; and document what a device wipe or an eDiscovery request means for this store.

**P1 — High priority**

Fail-open (H1) is correct for availability and wrong for a control, and the spec does not acknowledge the tension. If the broker is down, everything the operator was gating now goes to the pane's own prompt — which is acceptable — but the *auto-allow pre-filter* in §12.3 runs inside the hook client and will keep allowing. Make explicit which decisions are availability decisions (fail open) and which are safety decisions (fail closed). Anything in `permissions.deny` must never be reachable by a console code path.

Prompt injection is the unaddressed adversarial case. An agent that reads a hostile file could emit content that renders in your console, or shapes a walkthrough to make a dangerous diff look benign. You are building the surface on which you will make trust decisions, from content partly authored by an untrusted source. At minimum: escape everything, never render agent-authored HTML, and show the raw diff rather than only the summary for any P0 decision.

**P2 — Recommendations**

Ship the audit log as a feature, not a byproduct. A defensible record of every agent action and every human approval is the single most valuable thing this project could produce for the wider organisation.

**Verdict:** do not write the gating hook until the data store is classified and IT is informed. The board and artifact layers raise none of these issues and can proceed immediately.

---

### Sasha Lindqvist — VP Product, Developer Platforms
**Rating: 🟡 CONCERNS**

**P0 — Blockers**

*The build order contradicts the strategy.* The JTBD analysis correctly concludes that the only defensible advantage is the artifact layer. The spec schedules the artifact layer as Phase 4 — last. Meanwhile Phases 2 and 3 build a board and a gate, which is precisely the territory Anthropic, cmux, ccmanager, and HumanLayer are all converging on and which Anthropic has already half-shipped. You are sequenced to spend your first six days on the commodity and your last four on the differentiator, at exactly the moment when the commodity is most likely to be obsoleted mid-build.

Invert it. Board (thin, read-only, consuming `claude agents --json`) → artifacts → gate, if ever.

**P1 — High priority**

There is no kill criterion. A project like this needs a date and a condition, written down now: *if Anthropic ships cross-session diff review or artifact generation by 1 November 2026, this project stops and the learning is written up.* Without that, sunk cost decides.

Consider the contribution path. Much of this could be a Claude Code plugin or a set of hooks published as a repo rather than bespoke local software. Same functionality, but maintenance is shared, the artifact is legible to others, and it serves the social job and objective (2) far better than a private tool. It also means Anthropic's roadmap absorbs your work rather than orphaning it.

**P2 — Recommendations**

The four differentiating capabilities are not equally valuable. My ranking on defensibility × effort: cross-project diff review (highest), batched comments, single digest, walkthrough generation (lowest — most likely to be commoditised by a model-generated summary in the product itself). Build in that order.

**Verdict:** right insight, wrong sequence. Reorder and set a kill date and I am comfortable.

---

### Reuben Adeyemi — Chief of Staff to a CTO
**Rating: 🔴 CRITICAL**

**P0 — Blockers**

*The cost estimate omits the largest cost.* Ten engineer-days is quoted as though this were a junior's ticket. It is ten days of an SVP's attention, in an organisation where two other programmes explicitly outrank the AI mandate. The relevant comparison is not "ten days versus recovered agent capacity." It is "ten days of this versus ten days of stakeholder alignment on the mandate that is currently ranked third."

I have watched capable senior technologists build excellent internal tools as a legible substitute for the illegible, uncomfortable work of organisational persuasion. Building produces visible progress, immediate feedback, and full control. Stakeholder work produces none of those. I am not asserting that is what is happening here. I am saying the JTBD analysis surfaced a social job, declined to rank it against the functional job, and that omission is where this decision actually lives.

Answer Stage 1's objective question in writing before Phase 1. If the honest answer is (3) positioning, the correct build is roughly two days and a written account, and eight days return to the mandate.

**P1 — High priority**

The plan under-serves the social job it identified. A hardened private tool teaches the organisation nothing and cannot be pointed at. A rough v1, a 20-minute internal demo, and a written piece on what supervising ten agents actually requires — that travels, sets the pattern, and is a genuine input to how the company adopts agentic development. Same insight, a fraction of the effort, far more leverage.

**P2 — Recommendations**

Delegate Phases 2 and 4 with the spec as written. It is a good spec; that is the point of having written it. Retain the design decisions and the write-up.

**Verdict:** the artifact is good and the allocation is questionable. Answer the objective question first; it may cut the project by 80% without cutting the value.

---

### "Kamran, three months from now" — Skeptical End User
**Rating: 🟡 CONCERNS**

**P0 — Blockers**

*Nobody has budgeted maintenance.* A Claude Code release lands and hooks change. It is a Tuesday, RECITE is mid-crunch, and the console is emitting `ask` for everything. I will not fix it that week. I will disable it. Then it stays disabled, because re-adopting a tool is harder than adopting one. Every personal-tooling project of mine has died exactly here, not at the build.

Write down the maintenance budget — two hours a month, say — and a stated policy: if a Claude Code upgrade breaks it and it is not fixed within a week, it is turned off deliberately and the reason is logged. That policy is what converts an abandonment into a decision.

**P1 — High priority**

Under time pressure I will revert to the panes. Habit beats design, and the panes are where my hands already are. Anything requiring me to *choose* the console will lose. This argues for the digest notification being the load-bearing feature — it reaches me where I am rather than waiting for me to visit — and it argues against the second window (Priya's Option B point, from the other direction).

**P2 — Recommendations**

Nobody in this review has challenged the premise that 8–10 concurrent sessions is the right number. The cognitive-ceiling evidence says 3–5 steerable tasks. Perhaps the console is elaborate infrastructure for sustaining a concurrency level I should not be sustaining.

**Verdict:** I will use the board. I am doubtful I will maintain the gate. Build what survives my worst week.

---

## Panel Consensus

| Dimension | Rating | Blocking? |
|---|---|---|
| Problem validity (Real) | 🟢 | No |
| Measurement rigour | 🔴 | **Yes** |
| Security & data governance | 🔴 | **Yes — for the gate only** |
| Technical architecture | 🟡 | Yes — rendezvous spec |
| Strategic sequencing | 🟡 | Yes — reorder |
| Resource allocation | 🔴 | **Yes — answer the objective question** |
| Sustainability / adoption | 🟡 | No |
| UX design & prototype | 🟢 | No |

**Overall verdict: NEEDS WORK.** Not *do not build* — the problem is real and the prototype is good. But the plan as written measures nothing, sequences the differentiator last, treats its riskiest component as a detail, creates an unclassified data store on a managed endpoint, and omits the opportunity cost of the person doing the work.

### Required before any code

1. **Answer the Stage 1 objective question in writing.** (Reuben, P0.) Throughput, org reference implementation, or positioning. Everything downstream scales from this.
2. **Instrument for two days before changing anything.** (Marcus, P0.) Passive hook logging, no permission changes. This is also Phase 1's data layer, so it is nearly free.
3. **Operationalise the counter-metric.** (Marcus, P0.) Approved-then-abandoned plans, 48-hour reverts, time-on-decision for plan approvals.
4. **Classify the data store and inform IT.** (Dana, P0.) Metadata-and-hashes by default, payload capture opt-in and off, 7-day retention, encrypted at rest. Twenty minutes with security converts shadow tooling into a sanctioned pattern.
5. **Specify the rendezvous state machine and move `dispatch doctor` to Phase 1.** (Priya, P0.)
6. **Reorder the phases so the artifact layer precedes the gate.** (Sasha, P0.)
7. **Write a kill criterion with a date.** (Sasha, P1.) And a maintenance budget with an explicit turn-it-off policy. (Future-self, P0.)

### Where panelists disagreed

- **Priya vs. Future-self on the second window.** Priya prefers Textual for architectural simplicity; future-self warns any surface requiring a deliberate visit will lose to the panes. Both point to the same resolution: the notification digest, not the window, is the load-bearing feature. Whichever UI is chosen, the digest must work when the console is closed.
- **Dana vs. Priya on fail-open.** Priya wants availability; Dana wants a control that cannot silently lapse. Resolution: classify each decision path. Gating for convenience fails open to `ask`; anything in `permissions.deny` is never reachable by console code and therefore cannot fail at all.
- **Reuben vs. everyone on whether to build.** Reuben is the only panelist arguing the project may be 80% unnecessary. He is also the only one addressing what else those days could buy. His objection is not answerable by improving the spec.

---

# Part 3 — Revised Conclusions

## Amendments to the JTBD analysis

**Stage 1 — Outcome.** Add the baseline requirement and the operationalised counter-metric. No phase may claim success without a pre-change measurement. The business-objective question is promoted from "unresolved" to **blocking**.

**Stage 4 — Worth.** Downgrade from *conditionally yes* to *yes only under objective (1) or (2), and only after Experiments 1 and 2*. The original estimate counted build cost and omitted two larger costs: the opportunity cost of senior attention (Reuben) and ongoing maintenance against a fast-moving platform (future-self). Corrected: ~10 engineer-days of SVP attention, plus ~2 hours/month indefinitely, plus a security review, plus the risk of obsolescence within two quarters.

**Stage 5 — Risks.** Two categories were missing:

| Risk type | Assumption | Confidence | Impact if wrong |
|---|---|---|---|
| **Business / compliance** | An interception layer and a payload store on a managed endpoint are acceptable | **Low** | **Severe** — precedent, and a data-classification problem |
| **Sustainability** | This survives a Claude Code upgrade landing during a crunch week | **Low** | High — silent abandonment |

## Revised sequence

| Step | What | Days | Gate to proceed |
|---|---|---|---|
| **0** | Answer the objective question, in writing | 0.5 | If the answer is positioning: jump to step 3, then stop |
| **1** | Passive instrumentation only — hook event log, no behaviour change | 2 | Baseline recorded for prompt rate, time-to-unblock, idle-wait share |
| **2** | `dispatch doctor --hooks` — empirically verify every hook behaviour this design assumes | 1 | All assumed behaviours confirmed on the installed version |
| **3** | Phase 0 permission tuning + Experiment 2 (Wizard-of-Oz board) | 2 | **If prompts < 10/hr and speculative pane-visiting stops → STOP. Write it up.** |
| **4** | Thin read-only board consuming `claude agents --json`, plus the batched digest | 2 | Digest works with the console closed |
| **5** | Artifact layer — cross-project diff review first, then batched comments | 3 | Experiment 3 showed the artifact caught something the pane did not |
| **6** | Gating hook — **only** after the data store is classified and IT is informed | 3 | Rendezvous state machine specified; fail-open/fail-closed paths separated |
| **7** | Write-up and internal demo | 1 | — |

Net effect: the two cheapest steps (3 and 4) are now positioned to make steps 5 and 6 unnecessary, the differentiator moved ahead of the commodity, and the most compliance-sensitive component moved last where it can be cut without loss.

## Kill criteria

- If Anthropic ships cross-session diff review or per-session artifact generation before **1 November 2026** → stop, write up the learning.
- If step 3 clears its gate → stop at step 4.
- If maintenance exceeds **2 hours in any month** → turn it off deliberately, log the reason, do not let it rot.

## What survived the panel unchallenged

The problem is real. The state vocabulary borrowed from Claude Code is right. The artifact-first principle drawn from Antigravity and GitHub Agent HQ is right and is the strategic core. The prototype's interaction design — auto-advance, keyboard-first triage, batched comments — is good and needs no revision. The instinct not to duplicate `claude agents` is the most valuable judgement in the spec.

What needs to change is not the design. It is the order, the measurement, the governance, and the honest accounting of whose ten days these are.

---

*Discovery is iterative. Learning from steps 1–3 should loop back and revise the Outcome, Opportunity, and Solution before any further build. On the 50/500 rule: with n=1 the substitute for customer interviews is instrumented self-observation with a control period — which is why steps 1 and 3 are gates rather than warm-ups.*

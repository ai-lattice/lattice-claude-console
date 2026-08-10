import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  CircleDot, MessageSquareQuote, FileDiff, ScrollText, ClipboardCheck,
  CornerDownLeft, Check, X, Clock, Terminal, Pin, Send, ChevronRight,
  AlertTriangle, TimerReset, Lock, Eye, Layers,
} from "lucide-react";

/* ------------------------------------------------------------------ tokens */
const C = {
  ground: "#0B171C", panel: "#10222A", panelHi: "#153039",
  rule: "#1E3D48", ruleSoft: "#17323B",
  ink: "#DCE9ED", inkDim: "#8CA6AE", inkFaint: "#5A757E",
  amber: "#E8A33D", cyan: "#5BC8D6", slate: "#6E8A94",
  green: "#71A98C", red: "#D9614C", violet: "#9B8BC4",
};

const STATE = {
  needs_input: { label: "Needs input", color: C.amber, order: 1, pass: "triage" },
  blocked:     { label: "Blocked",     color: C.red,   order: 2, pass: "triage" },
  ready:       { label: "Ready for review", color: C.cyan, order: 3, pass: "review" },
  working:     { label: "Working",     color: C.slate, order: 4, pass: null },
  completed:   { label: "Completed",   color: C.green, order: 5, pass: null },
};

const GATE_TIMEOUT = 180;   // D7 — cut from 900
const MAX_EXTENDS = 3;
const CAPACITY_LIMIT = 5;   // U17

/* -------------------------------------------------------------- fake fleet */
const SEED = [
  {
    id: "checkout-svc", pinned: true, state: "needs_input", kind: "permission",
    age: 41, gating: true, deadline: 96, extends: 0, capture: true,
    summary: "Wants to run a Prisma migration against the staging database",
    ask: "Run `npx prisma migrate deploy` in ./checkout-svc?",
    tool: "Bash", args: "npx prisma migrate deploy --schema prisma/schema.prisma",
    why: "Added the `refund_reason` column in the last commit; the schema must be applied before the integration tests pass.",
  },
  {
    id: "billing-web", pinned: false, state: "needs_input", kind: "plan",
    age: 213, gating: true, deadline: 41, extends: 1, priority: "P0",
    summary: "Plan awaiting approval — refactor invoice totals into a shared module",
    ask: "Approve this plan?",
    plan: [
      "Extract `computeLineTotals` and `applyTaxRules` from InvoiceView into lib/totals.ts",
      "Add unit tests for the three rounding cases currently only covered end-to-end",
      "Update four call sites; keep the legacy `total()` export as a deprecated re-export",
      "Do NOT touch the Stripe webhook handler — explicitly out of scope",
    ],
    files: [{ path: "src/lib/totals.ts", add: 96, del: 0 }, { path: "src/InvoiceView.tsx", add: 8, del: 74 }],
    diff: [
      { t: "meta", s: "src/InvoiceView.tsx" },
      { t: "del", s: "  const total = lines.reduce((a, l) => a + l.qty * l.unit, 0)" },
      { t: "del", s: "  const tax = total * rateFor(region)" },
      { t: "add", s: "  const { total, tax } = computeLineTotals(lines, region)" },
      { t: "meta", s: "src/lib/totals.ts" },
      { t: "add", s: "export function computeLineTotals(lines: Line[], region: Region) {" },
      { t: "add", s: "  const total = round2(lines.reduce((a, l) => a + l.qty * l.unit, 0))" },
      { t: "add", s: "  return { total, tax: applyTaxRules(total, region) }" },
      { t: "add", s: "}" },
    ],
  },
  {
    id: "auth-gateway", pinned: false, state: "needs_input", kind: "question",
    age: 96, gating: true, deadline: 132, extends: 0,
    summary: "Asking which token lifetime to use for service-to-service calls",
    ask: "Should service tokens expire in 15 minutes like user tokens, or use a 12-hour lifetime with rotation?",
    options: ["15 min, match user tokens", "12 hr with rotation", "Let me explain the constraint"],
  },
  {
    id: "reporting-api", pinned: false, state: "blocked", kind: "error",
    age: 305, gating: false,
    summary: "Tool failed — pytest exited 2 during collection",
    ask: "pytest failed during collection. Retry, or investigate?",
    err: "ImportError: cannot import name 'Aggregate' from 'reporting.models'\n  test/test_rollup.py:4",
  },
  {
    id: "search-index", pinned: false, state: "ready", kind: "diff", age: 620,
    summary: "Rebuilt the analyzer chain; 6 files changed, tests green",
    files: [
      { path: "src/analyzer/chain.ts", add: 84, del: 31 },
      { path: "src/analyzer/tokenize.ts", add: 22, del: 4 },
      { path: "test/analyzer.spec.ts", add: 61, del: 0 },
    ],
    diff: [
      { t: "meta", s: "src/analyzer/chain.ts" },
      { t: "ctx", s: "export function buildChain(opts: ChainOpts) {" },
      { t: "del", s: "  const stages = [lowercase, stripPunct, stem]" },
      { t: "add", s: "  const stages = [lowercase, foldDiacritics, stripPunct, stem]" },
      { t: "add", s: "  if (opts.locale === 'tr') stages.splice(1, 0, turkishI)" },
      { t: "ctx", s: "  return (input: string) =>" },
      { t: "del", s: "    stages.reduce((acc, f) => f(acc), input)" },
      { t: "add", s: "    stages.reduce((acc, f) => f(acc), input.normalize('NFC'))" },
      { t: "ctx", s: "}" },
    ],
    walkthrough: "Replaced the hand-rolled folding table with Intl-backed diacritic folding, then added a Turkish dotless-i stage because the locale test failed on `ISTANBUL`. Normalized to NFC at the entry point so composed and decomposed inputs hash identically. Stemmer untouched.",
  },
  {
    id: "notifications", pinned: false, state: "ready", kind: "diff", age: 1450,
    summary: "Digest batching implemented; 3 files changed",
    files: [{ path: "src/digest.py", add: 47, del: 12 }, { path: "tests/test_digest.py", add: 38, del: 0 }],
    diff: [
      { t: "meta", s: "src/digest.py" },
      { t: "del", s: "for event in events: send(event)" },
      { t: "add", s: "for window, group in batch_by(events, seconds=90):" },
      { t: "add", s: "    send_digest(window, group)" },
    ],
    walkthrough: "Grouped outbound events into 90-second windows rather than firing per event. Chose 90s because the p95 gap between related events in the sample log was 71s.",
  },
  { id: "mobile-sync",   pinned: false, state: "working", age: 12,   summary: "Reading conflict-resolution code in sync/merge.kt" },
  { id: "admin-portal",  pinned: false, state: "working", age: 154,  summary: "Running the Playwright suite (18/44 passed)" },
  { id: "data-pipeline", pinned: false, state: "working", age: 88,   summary: "Writing the backfill script for the events table" },
  { id: "design-tokens", pinned: false, state: "completed", age: 2600, summary: "Token export merged; nothing pending" },
];

/* ----------------------------------------------------------------- helpers */
const fmtAge = (s) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`);
const mmss = (s) => `${Math.floor(Math.max(s, 0) / 60)}:${String(Math.max(s, 0) % 60).padStart(2, "0")}`;

/* ------------------------------------------------------------------ pieces */
function Chip({ state }) {
  const st = STATE[state];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-sm shrink-0"
      style={{ color: st.color, backgroundColor: `${st.color}1A`, fontFamily: "'IBM Plex Mono', monospace" }}>
      <CircleDot size={9} strokeWidth={3} />{st.label}
    </span>
  );
}

function Key({ children }) {
  return (
    <kbd className="px-1.5 py-0.5 text-xs rounded"
      style={{ backgroundColor: C.panelHi, color: C.inkDim, border: `1px solid ${C.rule}`, fontFamily: "'IBM Plex Mono', monospace" }}>
      {children}
    </kbd>
  );
}

function Countdown({ secs, extendCount }) {
  const crit = secs < 45;
  return (
    <span className="inline-flex items-center gap-1 text-xs shrink-0"
      style={{ color: crit ? C.red : C.amber, fontFamily: "'IBM Plex Mono', monospace" }}>
      <TimerReset size={10} />{mmss(secs)}
      {extendCount > 0 && <span style={{ color: C.inkFaint }}>+{extendCount}</span>}
    </span>
  );
}

function Row({ s, active, onClick, leaving }) {
  const st = STATE[s.state];
  const urgent = s.state === "needs_input" || s.state === "blocked";
  return (
    <button onClick={onClick}
      className="w-full text-left px-3 py-2.5 flex flex-col gap-1 transition-all duration-300 focus:outline-none"
      style={{
        borderLeft: `3px solid ${active ? st.color : "transparent"}`,
        backgroundColor: active ? C.panelHi : "transparent",
        opacity: leaving ? 0 : 1,
        transform: leaving ? "translateX(-12px)" : "none",
        maxHeight: leaving ? 0 : 200,
      }}>
      <div className="flex items-center gap-2">
        {s.pinned && <Pin size={11} style={{ color: C.inkFaint }} />}
        {s.priority === "P0" && (
          <span className="px-1 text-xs rounded" style={{ color: C.violet, backgroundColor: `${C.violet}22`, fontFamily: "'IBM Plex Mono', monospace" }}>P0</span>
        )}
        <span className="text-sm truncate" style={{ color: active ? C.ink : C.inkDim, fontFamily: "'IBM Plex Mono', monospace" }}>{s.id}</span>
        {s.capture && <Eye size={10} style={{ color: C.violet }} />}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {s.gating && s.deadline != null && <Countdown secs={s.deadline} extendCount={s.extends} />}
          <span className="flex items-center gap-1 text-xs" style={{ color: urgent ? st.color : C.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>
            <Clock size={10} />{fmtAge(s.age)}
          </span>
        </span>
      </div>
      <p className="text-xs leading-snug line-clamp-2" style={{ color: C.inkFaint }}>{s.summary}</p>
    </button>
  );
}

function DiffLine({ l, idx, comment, onAnnotate }) {
  if (l.t === "meta")
    return (
      <div className="px-3 py-1.5 mt-2 text-xs" style={{ color: C.inkDim, backgroundColor: C.panelHi, fontFamily: "'IBM Plex Mono', monospace" }}>{l.s}</div>
    );
  const map = { add: [C.green, "+"], del: [C.red, "−"], ctx: [C.inkFaint, " "] };
  const [col, sign] = map[l.t];
  return (
    <div>
      <button onClick={() => onAnnotate(idx)}
        className="w-full text-left flex gap-2 px-3 py-0.5 text-xs group focus:outline-none"
        style={{ fontFamily: "'IBM Plex Mono', monospace", backgroundColor: l.t === "add" ? `${C.green}12` : l.t === "del" ? `${C.red}12` : "transparent" }}>
        <span style={{ color: col }}>{sign}</span>
        {/* NF15 — plain text, fixed width, no markup interpretation */}
        <span className="flex-1 whitespace-pre-wrap" style={{ color: l.t === "ctx" ? C.inkFaint : C.ink }}>{l.s}</span>
        <MessageSquareQuote size={11} className="opacity-0 group-hover:opacity-60 shrink-0 mt-0.5" style={{ color: C.cyan }} />
      </button>
      {comment && (
        <div className="ml-6 mr-3 my-1 px-2 py-1.5 text-xs rounded-sm"
          style={{ backgroundColor: `${C.cyan}14`, borderLeft: `2px solid ${C.cyan}`, color: C.ink }}>{comment}</div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- main */
export default function AgentConsole() {
  const [sessions, setSessions] = useState(SEED);
  const [pass, setPass] = useState("triage");       // U15 — separate passes
  const [selId, setSelId] = useState("checkout-svc");
  const [tab, setTab] = useState("ask");
  const [seenPlan, setSeenPlan] = useState({});     // U8 — enforced gating
  const [reply, setReply] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);
  const [comments, setComments] = useState({});
  const [toast, setToast] = useState(null);
  const [leaving, setLeaving] = useState(null);
  const replyRef = useRef(null);

  const sel = sessions.find((s) => s.id === selId) || sessions[0];
  const counts = sessions.reduce((a, s) => ({ ...a, [s.state]: (a[s.state] || 0) + 1 }), {});
  const depth = (counts.needs_input || 0) + (counts.blocked || 0) + (counts.ready || 0);
  const selComments = comments[selId] || {};
  const commentCount = Object.keys(selComments).length;

  const isP0 = sel.priority === "P0";
  const planLocked = isP0 && !seenPlan[selId];      // U8 / NF16
  const actionable = STATE[sel.state].pass !== null;

  const ping = (m) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  useEffect(() => {
    const t = setInterval(() => setSessions((ss) => ss.map((s) => ({
      ...s,
      age: s.age + 1,
      deadline: s.gating && s.deadline != null ? s.deadline - 1 : s.deadline,
    }))), 1000);
    return () => clearInterval(t);
  }, []);

  /* H3 — expiry hands control back to the pane */
  useEffect(() => {
    const expired = sessions.find((s) => s.gating && s.deadline != null && s.deadline <= 0);
    if (!expired) return;
    setSessions((ss) => ss.map((x) => x.id === expired.id
      ? { ...x, gating: false, deadline: null, state: "working", age: 0, priority: null,
          summary: "Expired — handed back to the pane's own prompt" } : x));
    ping(`${expired.id} expired → returned to the pane`);
  }, [sessions]);

  const ordered = [...sessions].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const d = STATE[a.state].order - STATE[b.state].order;
    return d !== 0 ? d : b.age - a.age;
  });
  const inPass = ordered.filter((s) => STATE[s.state].pass === pass);

  const advance = useCallback((fromId) => {
    const next = inPass.find((s) => s.id !== fromId);
    if (next) { setSelId(next.id); setTab("ask"); }
    else ping(pass === "triage" ? "Triage clear — nothing waiting on you" : "Review queue clear");
  }, [inPass, pass]);

  const resolve = (id, verb) => {
    setLeaving(id);
    setTimeout(() => {
      setSessions((ss) => ss.map((s) => s.id === id
        ? { ...s, state: "working", age: 0, gating: false, deadline: null, pinned: false, priority: null, summary: `${verb} — session resumed` }
        : s));
      setLeaving(null); advance(id);
    }, 320);
    ping(`${verb} · ${id}`);
  };

  const extend = () => {
    if (!sel.gating) return;
    if (sel.extends >= MAX_EXTENDS) { ping("No extensions left — it will hand back to the pane"); return; }
    setSessions((ss) => ss.map((s) => s.id === selId
      ? { ...s, deadline: (s.deadline || 0) + GATE_TIMEOUT, extends: s.extends + 1 } : s));
    ping(`Extended ${selId} by 3 minutes`);
  };

  const move = (dir) => {
    const i = inPass.findIndex((s) => s.id === selId);
    const n = inPass[Math.min(Math.max(i + dir, 0), inPass.length - 1)];
    if (n) { setSelId(n.id); setTab("ask"); }
  };

  const switchPass = () => {
    const next = pass === "triage" ? "review" : "triage";
    setPass(next);
    const first = ordered.find((s) => STATE[s.state].pass === next);
    if (first) { setSelId(first.id); setTab(next === "review" ? "diff" : "ask"); }
    ping(next === "triage" ? "Triage pass — fast" : "Review pass — slower, deliberate");
  };

  const openPlan = () => { setTab("diff"); setSeenPlan((p) => ({ ...p, [selId]: true })); };

  const sendComments = () => {
    if (!commentCount) return;
    ping(`${commentCount} comment${commentCount > 1 ? "s" : ""} sent to ${selId}`);
    setComments((c) => ({ ...c, [selId]: {} }));
    setSessions((ss) => ss.map((s) => s.id === selId
      ? { ...s, state: "working", age: 0, summary: "Working through your review comments" } : s));
  };

  useEffect(() => {
    const onKey = (e) => {
      if (replyOpen) {
        if (e.key === "Escape") { setReplyOpen(false); setReply(""); }
        if (e.key === "Enter" && !e.shiftKey && reply.trim()) { e.preventDefault(); resolve(selId, "Replied"); setReplyOpen(false); setReply(""); }
        return;
      }
      const k = e.key.toLowerCase();
      if (e.key === "Tab") { e.preventDefault(); switchPass(); }
      else if (["j", "arrowdown"].includes(k)) { e.preventDefault(); move(1); }
      else if (["k", "arrowup"].includes(k)) { e.preventDefault(); move(-1); }
      else if (k === "a" && actionable) {
        if (planLocked) ping("Open the plan and raw diff first — P0 approvals require it");
        else resolve(selId, "Approved");
      }
      else if (k === "d" && actionable) resolve(selId, "Denied");
      else if (k === "i") { e.preventDefault(); setReplyOpen(true); setTimeout(() => replyRef.current?.focus(), 40); }
      else if (k === "x") extend();
      else if (k === "r") { if (sel.diff) openPlan(); }
      else if (k === "w") { if (sel.walkthrough) setTab("walk"); }
      else if (k === "s") { ping(`Snoozed ${selId} — deprioritised, timer stays visible`); advance(selId); }
      else if (k === "o") ping(`Jumped to iTerm2 pane · ${selId}`);
      else if (k === "p") setSessions((ss) => ss.map((s) => s.id === selId ? { ...s, pinned: !s.pinned } : s));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selId, sel, replyOpen, reply, inPass, pass, planLocked, actionable]);

  const tabs = [
    { id: "ask", label: "Request", icon: MessageSquareQuote, on: true },
    { id: "diff", label: isP0 ? "Plan & raw diff" : "Diff", icon: FileDiff, on: !!sel.diff },
    { id: "walk", label: "Walkthrough", icon: ScrollText, on: !!sel.walkthrough },
  ].filter((t) => t.on);

  return (
    <div className="w-full h-screen flex flex-col overflow-hidden"
      style={{ backgroundColor: C.ground, color: C.ink, fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
        @keyframes pulseRing { 0%,100%{opacity:.35} 50%{opacity:1} }
        .pulse { animation: pulseRing 2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .pulse { animation: none } }
        *:focus-visible { outline: 2px solid ${C.cyan}; outline-offset: -2px; }
        .line-clamp-2 { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      `}</style>

      {/* digest strip — N1 one line; N7 broker-emitted in production */}
      <header className="flex items-center gap-4 px-4 py-2.5 shrink-0 flex-wrap"
        style={{ borderBottom: `1px solid ${C.rule}`, backgroundColor: C.panel }}>
        <div className="flex items-center gap-2">
          <Terminal size={14} style={{ color: C.cyan }} />
          <span className="text-sm font-semibold tracking-tight">Dispatch</span>
        </div>
        <div className="flex items-center gap-3 text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          {Object.entries(STATE).map(([k, st]) => counts[k] ? (
            <span key={k} className={`flex items-center gap-1.5 ${k === "needs_input" ? "pulse" : ""}`} style={{ color: st.color }}>
              <CircleDot size={9} strokeWidth={3} />{counts[k]} {st.label.toLowerCase()}
            </span>
          ) : null)}
        </div>
        {depth > CAPACITY_LIMIT && (
          <span className="flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-sm"
            style={{ color: C.violet, backgroundColor: `${C.violet}1A`, fontFamily: "'IBM Plex Mono', monospace" }}>
            <AlertTriangle size={10} />depth {depth} — above sustainable review bandwidth
          </span>
        )}
        <span className="ml-auto text-xs" style={{ color: C.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>
          10 sessions · iTerm2 + tmux · local
        </span>
      </header>

      {/* U15 — pass switcher */}
      <div className="flex items-center gap-1 px-4 py-1.5 shrink-0 flex-wrap"
        style={{ borderBottom: `1px solid ${C.ruleSoft}`, backgroundColor: C.panel }}>
        {[["triage", "Triage", (counts.needs_input || 0) + (counts.blocked || 0)],
          ["review", "Review", counts.ready || 0]].map(([id, label, n]) => (
          <button key={id} onClick={() => { if (pass !== id) switchPass(); }}
            className="flex items-center gap-2 px-3 py-1 text-xs rounded-sm focus:outline-none"
            style={{
              color: pass === id ? C.ink : C.inkFaint,
              backgroundColor: pass === id ? C.panelHi : "transparent",
              border: `1px solid ${pass === id ? C.rule : "transparent"}`,
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
            <Layers size={11} />{label}<span style={{ color: C.inkFaint }}>{n}</span>
          </button>
        ))}
        <span className="ml-2 text-xs" style={{ color: C.inkFaint }}>
          {pass === "triage" ? "fast — clear the blockers" : "slow — read the artifact before deciding"}
        </span>
        <span className="ml-auto text-xs flex items-center gap-1.5" style={{ color: C.inkFaint }}><Key>Tab</Key>switch pass</span>
      </div>

      <div className="flex flex-1 min-h-0">
        <nav className="w-80 shrink-0 overflow-y-auto" style={{ borderRight: `1px solid ${C.rule}`, backgroundColor: C.panel }}>
          {Object.keys(STATE).map((key) => {
            const rows = ordered.filter((s) => s.state === key);
            if (!rows.length) return null;
            const otherPass = STATE[key].pass !== null && STATE[key].pass !== pass;
            return (
              <div key={key} style={{ opacity: STATE[key].pass === null ? 0.5 : otherPass ? 0.4 : 1 }}>
                <div className="px-3 py-1.5 text-xs sticky top-0 flex items-center gap-2"
                  style={{ color: STATE[key].color, backgroundColor: C.panel, borderBottom: `1px solid ${C.ruleSoft}`, fontFamily: "'IBM Plex Mono', monospace" }}>
                  {STATE[key].label}<span style={{ color: C.inkFaint }}>{rows.length}</span>
                </div>
                {rows.map((s) => (
                  <Row key={s.id} s={s} active={s.id === selId} leaving={leaving === s.id}
                    onClick={() => {
                      setSelId(s.id); setTab("ask");
                      if (STATE[s.state].pass) setPass(STATE[s.state].pass);
                    }} />
                ))}
              </div>
            );
          })}
        </nav>

        <main className="flex-1 flex flex-col min-w-0">
          <div className="px-5 pt-4 pb-3 shrink-0" style={{ borderBottom: `1px solid ${C.rule}` }}>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-base" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{sel.id}</h2>
              <Chip state={sel.state} />
              {isP0 && <span className="px-1.5 py-0.5 text-xs rounded" style={{ color: C.violet, backgroundColor: `${C.violet}22`, fontFamily: "'IBM Plex Mono', monospace" }}>P0 plan</span>}
              {sel.gating && sel.deadline != null && <Countdown secs={sel.deadline} extendCount={sel.extends} />}
              <span className="text-xs" style={{ color: C.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>waiting {fmtAge(sel.age)}</span>
              {sel.capture && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs rounded"
                  style={{ color: C.violet, backgroundColor: `${C.violet}1A`, fontFamily: "'IBM Plex Mono', monospace" }}>
                  <Eye size={10} />payload capture on
                </span>
              )}
            </div>
            {tabs.length > 1 && (
              <div className="flex gap-1 mt-3 -mb-3">
                {tabs.map((t) => (
                  <button key={t.id}
                    onClick={() => { setTab(t.id); if (t.id === "diff") setSeenPlan((p) => ({ ...p, [selId]: true })); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs focus:outline-none"
                    style={{ color: tab === t.id ? C.ink : C.inkFaint, borderBottom: `2px solid ${tab === t.id ? C.cyan : "transparent"}` }}>
                    <t.icon size={12} />{t.label}
                    {t.id === "diff" && planLocked && <Lock size={10} style={{ color: C.violet }} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {tab === "ask" && (
              <div className="p-5 space-y-4">
                {sel.ask ? (
                  <>
                    <p className="text-base leading-relaxed">{sel.ask}</p>
                    {planLocked && (
                      <div className="flex items-start gap-2 p-3 rounded-sm text-xs"
                        style={{ backgroundColor: `${C.violet}14`, borderLeft: `2px solid ${C.violet}`, color: C.ink }}>
                        <Lock size={13} style={{ color: C.violet }} className="shrink-0 mt-0.5" />
                        <span>
                          Plan approvals are rejected far more often than tool permissions, so approve stays locked until you have read the plan and the raw diff.{" "}
                          <button onClick={openPlan} className="underline focus:outline-none" style={{ color: C.cyan }}>Open plan &amp; raw diff</button> or press <Key>r</Key>.
                        </span>
                      </div>
                    )}
                    {sel.tool && (
                      <div className="p-3 rounded-sm" style={{ backgroundColor: C.panel, border: `1px solid ${C.rule}` }}>
                        <div className="text-xs mb-1.5" style={{ color: C.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>{sel.tool}</div>
                        <code className="text-xs break-all" style={{ color: C.amber, fontFamily: "'IBM Plex Mono', monospace" }}>{sel.args}</code>
                      </div>
                    )}
                    {sel.err && (
                      <pre className="p-3 rounded-sm text-xs whitespace-pre-wrap"
                        style={{ backgroundColor: `${C.red}12`, borderLeft: `2px solid ${C.red}`, color: C.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{sel.err}</pre>
                    )}
                    {sel.plan && (
                      <ol className="space-y-2">
                        {sel.plan.map((p, i) => (
                          <li key={i} className="flex gap-3 text-sm leading-relaxed">
                            <span className="shrink-0" style={{ color: C.cyan, fontFamily: "'IBM Plex Mono', monospace" }}>{String(i + 1).padStart(2, "0")}</span>
                            <span style={{ color: C.inkDim }}>{p}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                    {sel.options && (
                      <div className="space-y-1.5">
                        {sel.options.map((o, i) => (
                          <button key={i} onClick={() => resolve(sel.id, "Answered")}
                            className="w-full text-left px-3 py-2 text-sm rounded-sm flex items-center gap-3 focus:outline-none"
                            style={{ backgroundColor: C.panel, border: `1px solid ${C.rule}`, color: C.inkDim }}>
                            <span style={{ color: C.cyan, fontFamily: "'IBM Plex Mono', monospace" }}>{i + 1}</span>{o}
                          </button>
                        ))}
                      </div>
                    )}
                    {sel.why && <p className="text-xs leading-relaxed" style={{ color: C.inkFaint }}>{sel.why}</p>}
                  </>
                ) : (
                  <div className="pt-8 text-center">
                    <p className="text-sm" style={{ color: C.inkDim }}>{sel.summary}</p>
                    <p className="text-xs mt-2" style={{ color: C.inkFaint }}>Nothing waiting on you here. Press <Key>o</Key> to open the pane.</p>
                  </div>
                )}
              </div>
            )}

            {tab === "diff" && sel.diff && (
              <div className="pb-4">
                <div className="px-5 py-3 flex flex-wrap gap-4 text-xs"
                  style={{ borderBottom: `1px solid ${C.ruleSoft}`, fontFamily: "'IBM Plex Mono', monospace" }}>
                  {sel.files.map((f) => (
                    <span key={f.path} style={{ color: C.inkDim }}>
                      {f.path} <span style={{ color: C.green }}>+{f.add}</span> <span style={{ color: C.red }}>−{f.del}</span>
                    </span>
                  ))}
                </div>
                <p className="px-5 py-2 text-xs" style={{ color: C.inkFaint }}>
                  Raw diff — a walkthrough is never the sole basis for approving. Click any line to comment; comments send as one batch.
                </p>
                {sel.diff.map((l, i) => (
                  <DiffLine key={i} l={l} idx={i} comment={selComments[i]}
                    onAnnotate={(idx) => {
                      const txt = window.prompt("Comment on this line");
                      if (txt) setComments((c) => ({ ...c, [selId]: { ...(c[selId] || {}), [idx]: txt } }));
                    }} />
                ))}
                {commentCount > 0 && (
                  <div className="px-5 pt-4">
                    <button onClick={sendComments}
                      className="flex items-center gap-2 px-3 py-2 text-sm rounded-sm focus:outline-none"
                      style={{ backgroundColor: `${C.cyan}1F`, color: C.cyan, border: `1px solid ${C.cyan}` }}>
                      <Send size={13} />Send {commentCount} comment{commentCount > 1 ? "s" : ""}
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === "walk" && sel.walkthrough && (
              <div className="p-5">
                <div className="flex items-center gap-2 mb-3 text-xs" style={{ color: C.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>
                  <ClipboardCheck size={12} />generated from the session transcript · treat as untrusted
                </div>
                {/* NF17 — quoted, visually distinguished from console chrome */}
                <p className="text-sm leading-relaxed pl-3" style={{ color: C.inkDim, borderLeft: `2px solid ${C.rule}` }}>{sel.walkthrough}</p>
              </div>
            )}
          </div>

          {actionable && (
            <div className="shrink-0 px-5 py-3 flex items-center gap-2 flex-wrap"
              style={{ borderTop: `1px solid ${C.rule}`, backgroundColor: C.panel }}>
              {replyOpen ? (
                <>
                  <input ref={replyRef} value={reply} onChange={(e) => setReply(e.target.value)}
                    placeholder="Type your answer, Enter to send"
                    className="flex-1 px-3 py-2 text-sm rounded-sm focus:outline-none"
                    style={{ backgroundColor: C.ground, border: `1px solid ${C.cyan}`, color: C.ink, fontFamily: "'IBM Plex Mono', monospace" }} />
                  <button onClick={() => { if (reply.trim()) { resolve(selId, "Replied"); setReplyOpen(false); setReply(""); } }}
                    className="px-3 py-2 text-sm rounded-sm flex items-center gap-1.5 focus:outline-none"
                    style={{ backgroundColor: `${C.cyan}1F`, color: C.cyan }}>
                    <CornerDownLeft size={13} />Send
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => planLocked ? ping("Open the plan and raw diff first") : resolve(selId, "Approved")}
                    disabled={planLocked}
                    className="px-3 py-2 text-sm rounded-sm flex items-center gap-1.5 focus:outline-none"
                    style={{
                      backgroundColor: planLocked ? C.panelHi : `${C.green}1F`,
                      color: planLocked ? C.inkFaint : C.green,
                      border: `1px solid ${planLocked ? C.rule : `${C.green}66`}`,
                      cursor: planLocked ? "not-allowed" : "pointer",
                    }}>
                    {planLocked ? <Lock size={13} /> : <Check size={13} />}Approve <Key>a</Key>
                  </button>
                  <button onClick={() => resolve(selId, "Denied")}
                    className="px-3 py-2 text-sm rounded-sm flex items-center gap-1.5 focus:outline-none"
                    style={{ backgroundColor: `${C.red}1A`, color: C.red, border: `1px solid ${C.red}55` }}>
                    <X size={13} />Deny <Key>d</Key>
                  </button>
                  <button onClick={() => { setReplyOpen(true); setTimeout(() => replyRef.current?.focus(), 40); }}
                    className="px-3 py-2 text-sm rounded-sm flex items-center gap-1.5 focus:outline-none"
                    style={{ backgroundColor: C.panelHi, color: C.inkDim, border: `1px solid ${C.rule}` }}>
                    <MessageSquareQuote size={13} />Reply <Key>i</Key>
                  </button>
                  {sel.gating && (
                    <button onClick={extend}
                      className="px-3 py-2 text-sm rounded-sm flex items-center gap-1.5 focus:outline-none"
                      style={{ backgroundColor: C.panelHi, color: sel.extends >= MAX_EXTENDS ? C.inkFaint : C.amber, border: `1px solid ${C.rule}` }}>
                      <TimerReset size={13} />Extend <Key>x</Key>
                      <span className="text-xs" style={{ color: C.inkFaint }}>{sel.extends}/{MAX_EXTENDS}</span>
                    </button>
                  )}
                  <button onClick={() => ping(`Jumped to iTerm2 pane · ${selId}`)}
                    className="ml-auto px-3 py-2 text-sm rounded-sm flex items-center gap-1.5 focus:outline-none" style={{ color: C.inkFaint }}>
                    Open pane <ChevronRight size={13} />
                  </button>
                </>
              )}
            </div>
          )}
        </main>
      </div>

      <footer className="shrink-0 flex items-center gap-4 px-4 py-2 text-xs overflow-x-auto"
        style={{ borderTop: `1px solid ${C.rule}`, backgroundColor: C.panel, color: C.inkFaint }}>
        {[["Tab", "pass"], ["j / k", "move"], ["a", "approve"], ["d", "deny"], ["i", "reply"],
          ["x", "extend"], ["r", "diff"], ["w", "walkthrough"], ["s", "snooze"], ["o", "pane"], ["p", "pin"]].map(([k, l]) => (
          <span key={k} className="flex items-center gap-1.5 shrink-0"><Key>{k}</Key>{l}</span>
        ))}
        <span className="ml-auto shrink-0">answering auto-advances within the pass</span>
      </footer>

      {toast && (
        <div className="fixed bottom-14 left-1/2 px-4 py-2 text-sm rounded-sm"
          style={{ transform: "translateX(-50%)", backgroundColor: C.panelHi, border: `1px solid ${C.rule}`, color: C.ink, fontFamily: "'IBM Plex Mono', monospace" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

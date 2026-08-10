// Model pricing in USD per million tokens. Cache reads bill at ~0.1x input,
// 5-minute-TTL cache writes at 1.25x, 1-hour-TTL writes at 2x input.
// Source: Anthropic pricing as of 2026-08 — update here when prices change.
const PRICES = [
  { match: /^claude-fable-5/, input: 10, output: 50 },
  { match: /^claude-mythos/, input: 10, output: 50 },
  { match: /^claude-opus-5/, input: 5, output: 25 },
  { match: /^claude-opus-4-[678]/, input: 5, output: 25 },
  { match: /^claude-opus-4-5/, input: 5, output: 25 },
  { match: /^claude-opus/, input: 15, output: 75 }, // opus 4.1/4.0/3 legacy
  { match: /^claude-sonnet/, input: 3, output: 15 },
  { match: /^claude-3-7-sonnet/, input: 3, output: 15 },
  { match: /^claude-haiku-4-5/, input: 1, output: 5 },
  { match: /^claude-haiku/, input: 1, output: 5 },
  { match: /^claude-3-5-haiku/, input: 0.8, output: 4 },
  { match: /./, input: 5, output: 25 }, // unknown model fallback: Opus-tier
];

export function priceFor(model) {
  const m = PRICES.find((p) => p.match.test(model || ''));
  return { input: m.input, output: m.output };
}

// usage: {input_tokens, output_tokens, cache_read_input_tokens, cache_creation:{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}, cache_creation_input_tokens}
export function costOf(model, u) {
  if (!u) return 0;
  const p = priceFor(model);
  const per = 1e6;
  const in5m = u.cache_creation?.ephemeral_5m_input_tokens;
  const in1h = u.cache_creation?.ephemeral_1h_input_tokens;
  // When the split is unavailable, treat all cache writes as 5m-TTL (1.25x).
  const write5m = in5m ?? (in1h === undefined ? (u.cache_creation_input_tokens || 0) : 0);
  const write1h = in1h ?? 0;
  return (
    ((u.input_tokens || 0) * p.input) / per +
    ((u.output_tokens || 0) * p.output) / per +
    ((u.cache_read_input_tokens || 0) * p.input * 0.1) / per +
    (write5m * p.input * 1.25) / per +
    (write1h * p.input * 2) / per
  );
}

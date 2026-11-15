/**
 * model-pricing.ts — Pure pricing data and cost math (no Node imports).
 *
 * Single source of truth shared by:
 * - the daemon   → src/pricing.ts re-exports it (adds config-aware helpers)
 * - the dashboard → dashboard/src/lib/pricing.ts imports it directly
 *
 * Prices are in USD per million tokens.
 * Source: https://platform.claude.com/docs/en/about-claude/pricing
 */

export interface ModelPricing {
  input: number
  output: number
  cacheRead: number
  cacheCreate: number
}

/**
 * Official first-party rates, verified 2026-11-15 against
 * https://platform.claude.com/docs/en/about-claude/pricing
 *
 * Order matters for the family fallback: within each family the newest model
 * comes first, so an unknown future version (e.g. 'claude-opus-9') bills at
 * the newest known price of its family. Dated/suffixed IDs ('…-20251101',
 * '…[1m]') resolve by the longest key they contain, so order does not matter
 * for those.
 * cacheCreate is the 5-minute TTL write rate. Cache reads are 0.025x input on
 * Fable/Mythos 5.1+, 0.05x on Opus 5.5 / Sonnet 5.5 and 0.1x elsewhere.
 */
export const PRICING: Record<string, ModelPricing> = {
  'claude-fable-5-2':           { input: 8,    output: 40,   cacheRead: 0.20, cacheCreate: 10    },
  'claude-fable-5-1':           { input: 10,   output: 50,   cacheRead: 0.25, cacheCreate: 12.50 },
  'claude-fable-5':             { input: 10,   output: 50,   cacheRead: 1.00, cacheCreate: 12.50 },
  'claude-mythos-5-2':          { input: 8,    output: 40,   cacheRead: 0.20, cacheCreate: 10    },
  'claude-mythos-5-1':          { input: 10,   output: 50,   cacheRead: 0.25, cacheCreate: 12.50 },
  'claude-mythos-5':            { input: 10,   output: 50,   cacheRead: 1.00, cacheCreate: 12.50 },
  'claude-opus-5-5':            { input: 4,    output: 20,   cacheRead: 0.20, cacheCreate: 5.00  },
  'claude-opus-5':              { input: 5,    output: 25,   cacheRead: 0.50, cacheCreate: 6.25  },
  'claude-opus-4-8':            { input: 5,    output: 25,   cacheRead: 0.50, cacheCreate: 6.25  },
  'claude-opus-4-7':            { input: 5,    output: 25,   cacheRead: 0.50, cacheCreate: 6.25  },
  'claude-opus-4-6':            { input: 5,    output: 25,   cacheRead: 0.50, cacheCreate: 6.25  },
  'claude-opus-4-5':            { input: 5,    output: 25,   cacheRead: 0.50, cacheCreate: 6.25  },
  'claude-opus-4-1':            { input: 15,   output: 75,   cacheRead: 1.50, cacheCreate: 18.75 },
  // Opus 4 / Sonnet 4 only by their dated IDs: a bare 'claude-opus-4' key would
  // swallow every future 'claude-opus-4-N' and bill it at $15/$75.
  'claude-opus-4-20250514':     { input: 15,   output: 75,   cacheRead: 1.50, cacheCreate: 18.75 },
  'claude-sonnet-5-5':          { input: 2,    output: 10,   cacheRead: 0.10, cacheCreate: 2.50  },
  'claude-sonnet-5':            { input: 2,    output: 10,   cacheRead: 0.20, cacheCreate: 2.50  },
  'claude-sonnet-4-6':          { input: 3,    output: 15,   cacheRead: 0.30, cacheCreate: 3.75  },
  'claude-sonnet-4-5':          { input: 3,    output: 15,   cacheRead: 0.30, cacheCreate: 3.75  },
  'claude-sonnet-4-20250514':   { input: 3,    output: 15,   cacheRead: 0.30, cacheCreate: 3.75  },
  'claude-haiku-5-5':           { input: 0.10, output: 0.50, cacheRead: 0.01, cacheCreate: 0.125 },
  'claude-haiku-4-5':           { input: 1,    output: 5,    cacheRead: 0.10, cacheCreate: 1.25  },
  'claude-haiku-4-5-20251001':  { input: 1,    output: 5,    cacheRead: 0.10, cacheCreate: 1.25  },
}

/**
 * Models priced by prompt length: a request whose prompt (input + cache reads
 * + cache writes) exceeds the threshold pays these rates for the whole request.
 */
const LONG_CONTEXT_PRICING: Record<string, { thresholdTokens: number; pricing: ModelPricing }> = {
  'claude-haiku-5-5': {
    thresholdTokens: 100_000,
    pricing: { input: 0.50, output: 2.50, cacheRead: 0.05, cacheCreate: 0.625 },
  },
}

/** Kept for the public library API; no longer used as a lookup fallback. */
export const DEFAULT_PRICING: ModelPricing = PRICING['claude-sonnet-4-6']

/**
 * Returned for models with no known price. All-zero on purpose: an unknown
 * model costs $0 and is flagged unpriced instead of being estimated at
 * Sonnet rates (which made e.g. OpenCode's free models look paid).
 */
export const UNPRICED: Readonly<ModelPricing> = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 })

export const DEFAULT_MODEL = 'claude-sonnet-4-6'

// ─── Context Windows ──────────────────────────────────────────────────────────

/**
 * Context window per Claude model ID, in tokens — Claude Code's auto-compact
 * window as reported by its `/context` command, NOT the API spec window:
 * Anthropic documents 1M for these models, but real logs never exceed ~966.5K
 * (965,904 max measured on opus-5-5). Usage % and the 50/75/90 thresholds are
 * computed against these values, so 100% is where Claude Code compacts.
 * 200K-window models (Opus 4.5, Sonnet 4.5, Haiku 4.5) keep 200K.
 *
 * Claude models only: OpenCode reads each provider/model window from its own
 * models-dev catalog (src/watchers/oc-catalog.ts) and falls back to this table.
 * Unknown models: 200,000 tokens (see getContextWindow).
 */
const CC_1M_WINDOW = 967_000
export const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-fable-5-2':           CC_1M_WINDOW,
  'claude-fable-5-1':           CC_1M_WINDOW,
  'claude-fable-5':             CC_1M_WINDOW,
  'claude-mythos-5-2':          CC_1M_WINDOW,
  'claude-mythos-5-1':          CC_1M_WINDOW,
  'claude-mythos-5':            CC_1M_WINDOW,
  'claude-opus-5-5':            CC_1M_WINDOW,
  'claude-opus-5':              CC_1M_WINDOW,
  'claude-opus-4-8':            CC_1M_WINDOW,
  'claude-opus-4-7':            CC_1M_WINDOW,
  'claude-opus-4-6':            200_000,
  'claude-opus-4-5':            200_000,
  'claude-sonnet-5-5':          CC_1M_WINDOW,
  'claude-sonnet-5':            CC_1M_WINDOW,
  'claude-sonnet-4-6':          200_000,
  'claude-sonnet-4-5':          200_000,
  'claude-haiku-5-5':           CC_1M_WINDOW,
  'claude-haiku-4-5':           200_000,
  'claude-haiku-4-5-20251001':  200_000,
}

// ─── Lookup ───────────────────────────────────────────────────────────────────

const FAMILIES = ['fable', 'mythos', 'opus', 'sonnet', 'haiku'] as const

/** Longest table key contained in the model ID ('claude-opus-4-8[1m]' → 'claude-opus-4-8'). */
function longestKeyIn(m: string, table: Record<string, unknown>): string | null {
  let best: string | null = null
  for (const k of Object.keys(table)) {
    if (m.includes(k) && (!best || k.length > best.length)) best = k
  }
  return best
}

/**
 * Resolve the PRICING key for a model ID, or null when no Claude price applies:
 * exact ID → longest contained key (dated/[1m] suffix) → family (newest known).
 */
function resolvePricingKey(model?: string | null): string | null {
  const m = (model ?? '').toLowerCase()
  if (!m) return null
  if (PRICING[m]) return m
  const contained = longestKeyIn(m, PRICING)
  if (contained) return contained
  const family = FAMILIES.find(f => m.includes(f))
  return (family && Object.keys(PRICING).find(k => k.includes(family))) || null
}

/** Pricing for a model ID; UNPRICED (all zero) when the model is unknown. */
export function pricingFor(model?: string | null): ModelPricing {
  const key = resolvePricingKey(model)
  return key ? PRICING[key] : UNPRICED
}

/** True when the model resolves to a known Claude price. */
export function isPriced(model?: string | null): boolean {
  return resolvePricingKey(model) !== null
}

/** Known Claude Code context window for a model ID, or null when unknown. */
export function knownContextWindow(model?: string | null): number | null {
  const m = (model ?? '').toLowerCase()
  if (!m) return null
  const key = KNOWN_CONTEXT_WINDOWS[m] ? m : longestKeyIn(m, KNOWN_CONTEXT_WINDOWS)
  return key ? KNOWN_CONTEXT_WINDOWS[key] : null
}

export interface ModelPrice {
  input:  number
  output: number
}

export function findPricing(model: string): ModelPrice | null {
  const key = Object.keys(PRICING).find(k => model.toLowerCase().includes(k))
  return key ? { input: PRICING[key].input, output: PRICING[key].output } : null
}

// ─── Cost Calculation ─────────────────────────────────────────────────────────

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/**
 * Rates that apply to one request: the long-context tier when the model has
 * one and the prompt (input + cache reads + cache writes) exceeds it.
 * UNPRICED for unknown models.
 */
export function pricingForUsage(model: string, usage: Partial<TokenUsage>): ModelPricing {
  const key = resolvePricingKey(model)
  if (!key) return UNPRICED
  const tier = LONG_CONTEXT_PRICING[key]
  if (tier) {
    const prompt = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    if (prompt > tier.thresholdTokens) return tier.pricing
  }
  return PRICING[key]
}

/** Cost of a usage record plus whether the model had a known price. */
export function priceUsage(model: string, usage: TokenUsage): { cost_usd: number; priced: boolean } {
  if (!isPriced(model)) return { cost_usd: 0, priced: false }
  const price = pricingForUsage(model, usage)
  const M = 1_000_000
  const cost_usd =
    (usage.input_tokens                * price.input)       / M +
    (usage.output_tokens               * price.output)      / M +
    (usage.cache_read_input_tokens     * price.cacheRead)   / M +
    (usage.cache_creation_input_tokens * price.cacheCreate) / M
  return { cost_usd, priced: true }
}

/** Cost in USD; 0 for unpriced models (check isPriced/priceUsage to tell them apart). */
export function calcCost(model: string, usage: TokenUsage): number {
  return priceUsage(model, usage).cost_usd
}

export function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  const M = 1_000_000
  const price = pricingFor(model)
  return (inputTokens / M) * price.input + (outputTokens / M) * price.output
}

// ─── Tool Token Estimates ─────────────────────────────────────────────────────

/** Average tokens per tool call type — used when real tokens are unavailable. */
export const TOOL_TOKEN_ESTIMATE: Record<string, number> = {
  bash:    300,
  read:   1500,
  edit:    800,
  write:  1000,
  glob:    200,
  grep:    400,
  default: 300,
}

export function estimateTokensFromToolCounts(toolCounts: Record<string, number>): number {
  let total = 0
  for (const [tool, count] of Object.entries(toolCounts)) {
    const key = tool.toLowerCase()
    const avg = TOOL_TOKEN_ESTIMATE[key] ?? TOOL_TOKEN_ESTIMATE.default
    total += avg * count
  }
  return Math.round(total)
}

// Legacy alias — prefer PRICING
export const MODEL_PRICING = PRICING

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
 * Newest first: family fallback (pricingFor) picks the first entry that
 * matches the family, so unknown future versions bill at current prices.
 */
export const PRICING: Record<string, ModelPricing> = {
  'claude-opus-5-5':            { input: 4,    output: 20,  cacheRead: 0.20, cacheCreate: 5.00 },
  'claude-sonnet-5':            { input: 2,    output: 10,  cacheRead: 0.20, cacheCreate: 2.50  },
  'claude-opus-4-6':            { input: 5,    output: 25,  cacheRead: 0.50, cacheCreate: 6.25  },
  'claude-sonnet-4-6':          { input: 3,    output: 15,  cacheRead: 0.30, cacheCreate: 3.75  },
  'claude-haiku-4-5':           { input: 1,    output: 5,   cacheRead: 0.10, cacheCreate: 1.25  },
  'claude-haiku-4-5-20251001':  { input: 1,    output: 5,   cacheRead: 0.10, cacheCreate: 1.25  },
}

export const DEFAULT_PRICING: ModelPricing = PRICING['claude-sonnet-4-6']

export const DEFAULT_MODEL = 'claude-sonnet-4-6'

// ─── Context Windows ──────────────────────────────────────────────────────────

/**
 * Context window per model ID, in tokens — Claude Code's auto-compact window
 * as reported by its `/context` command, NOT the API spec window: Anthropic
 * documents 1M for these models, but real logs never exceed ~966.5K. Usage %
 * and the 50/75/90 thresholds are computed against these values, so 100% is
 * the point where Claude Code actually compacts.
 *
 * Fallback for unknown models: 200,000 tokens.
 */
export const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-5-5':            967_000,
  'claude-sonnet-5':            967_000,
  'claude-opus-4-6':            200_000,
  'claude-sonnet-4-6':          200_000,
  'claude-haiku-4-5':           200_000,
  'claude-haiku-4-5-20251001':  200_000,
  'deepseek-v4-flash-free':     1_000_000,
}

// ─── Pricing Lookup ───────────────────────────────────────────────────────────

const FAMILIES = ['opus', 'sonnet', 'haiku'] as const

/**
 * Resolve pricing for a model ID:
 * exact ID → known key (dated suffix) → family (newest known) → Sonnet default.
 * Unknown opus/sonnet/haiku versions no longer fall back to Sonnet prices.
 */
export function pricingFor(model?: string | null): ModelPricing {
  const m = (model ?? '').toLowerCase()
  if (m) {
    if (PRICING[m]) return PRICING[m]
    const exact = Object.keys(PRICING).find(k => m.includes(k))
    if (exact) return PRICING[exact]
    const family = FAMILIES.find(f => m.includes(f))
    const familyKey = family && Object.keys(PRICING).find(k => k.includes(family))
    if (familyKey) return PRICING[familyKey]
  }
  return DEFAULT_PRICING
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

export function calcCost(
  model: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
): number {
  const price = pricingFor(model)
  const M = 1_000_000
  return (
    (usage.input_tokens                  * price.input)       / M +
    (usage.output_tokens                 * price.output)      / M +
    (usage.cache_read_input_tokens       * price.cacheRead)   / M +
    (usage.cache_creation_input_tokens * price.cacheCreate) / M
  )
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

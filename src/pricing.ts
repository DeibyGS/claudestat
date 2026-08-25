/**
 * pricing.ts — Centralized pricing, context windows, thresholds, and cost calculation
 *
 * Single source of truth for:
 * - Model pricing (USD per 1M tokens)
 * - Known context windows
 * - Context notification thresholds
 * - Default model fallback
 * - Tool token estimates
 *
 * Prices are in USD per million tokens.
 */

import { readConfig } from './config'

// ─── Model Pricing ────────────────────────────────────────────────────────────

export interface ModelPricing {
  input: number
  output: number
  cacheRead: number
  cacheCreate: number
}

export const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6':            { input: 15,   output: 75,  cacheRead: 1.50, cacheCreate: 18.75 },
  'claude-sonnet-4-6':          { input: 3,    output: 15,  cacheRead: 0.30, cacheCreate: 3.75  },
  'claude-haiku-4-5':           { input: 0.80, output: 4,   cacheRead: 0.08, cacheCreate: 1.00  },
  'claude-haiku-4-5-20251001':  { input: 0.80, output: 4,   cacheRead: 0.08, cacheCreate: 1.00  },
}

export const DEFAULT_PRICING = PRICING['claude-sonnet-4-6']

// ─── Default Model ────────────────────────────────────────────────────────────

export const DEFAULT_MODEL = 'claude-sonnet-4-6'

// ─── Context Windows ──────────────────────────────────────────────────────────

/**
 * Known context windows by model ID.
 * To add a new model: add an entry with the model ID as key and context size as value.
 * Fallback for unknown models: 200,000 tokens.
 */
export const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-6':          200_000,
  'claude-sonnet-4-6':        200_000,
  'claude-haiku-4-5':         200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-sonnet-5':          967_000,
  'deepseek-v4-flash-free':   1_000_000,
}

/**
 * Get context window for a model.
 * Priority: config override → KNOWN_CONTEXT_WINDOWS → 200K fallback.
 */
export function getContextWindow(model: string): number {
  try {
    const config = readConfig()
    if (model in config.contextWindowOverrides) {
      return config.contextWindowOverrides[model]
    }
  } catch { /* ignore config read errors */ }
  return KNOWN_CONTEXT_WINDOWS[model] ?? 200_000
}

// ─── Context Thresholds ───────────────────────────────────────────────────────

/** Context usage % thresholds for notifications: [50%, 75%, 90%] */
export const CONTEXT_THRESHOLDS = [50, 75, 90] as const

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

// ─── Cost Calculation ─────────────────────────────────────────────────────────

export function calcCost(
  model: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
): number {
  const price = PRICING[model] ?? DEFAULT_PRICING
  const M = 1_000_000
  return (
    (usage.input_tokens                  * price.input)       / M +
    (usage.output_tokens                 * price.output)      / M +
    (usage.cache_read_input_tokens       * price.cacheRead)   / M +
    (usage.cache_creation_input_tokens * price.cacheCreate) / M
  )
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

export function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  const M = 1_000_000
  const price = PRICING[model] ?? DEFAULT_PRICING
  return (inputTokens / M) * price.input + (outputTokens / M) * price.output
}

// ─── Pricing Lookup ───────────────────────────────────────────────────────────

export interface ModelPrice {
  input:  number
  output: number
}

export function findPricing(model: string): ModelPrice | null {
  const key = Object.keys(PRICING).find(k => model.toLowerCase().includes(k))
  return key ? { input: PRICING[key].input, output: PRICING[key].output } : null
}

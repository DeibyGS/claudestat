/**
 * pricing.ts — Model pricing constants and cost calculation
 * 
 * Centralized pricing data to avoid duplication across enricher.ts and project-scanner.ts.
 * Prices are in USD per million tokens.
 */

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
  'deepseek-v4-flash-free':   1_000_000,
}

export function getContextWindow(model: string): number {
  return KNOWN_CONTEXT_WINDOWS[model] ?? 200_000
}

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
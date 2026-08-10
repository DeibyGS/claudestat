/**
 * model-pricing.ts — Re-export barrel for backward compatibility.
 *
 * All pricing data has been consolidated into pricing.ts.
 * This file re-exports types and functions for existing consumers.
 */

export type { ModelPrice } from './pricing'
export { PRICING, DEFAULT_MODEL, TOOL_TOKEN_ESTIMATE, estimateTokensFromToolCounts, estimateCost, findPricing } from './pricing'

// Legacy alias — prefer importing from pricing.ts directly
import { PRICING } from './pricing'
export const MODEL_PRICING = PRICING

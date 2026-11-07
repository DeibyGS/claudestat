/**
 * pricing.ts — Centralized pricing, context windows, thresholds, and cost calculation
 *
 * Pure data (prices, context windows, cost math) lives in model-pricing.ts so the
 * dashboard can import it without Node dependencies. This module re-exports it
 * and adds the config-aware pieces.
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
import { KNOWN_CONTEXT_WINDOWS } from './model-pricing'

export * from './model-pricing'

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

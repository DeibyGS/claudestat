/**
 * pricing.ts — Dashboard view of the daemon's pricing table.
 *
 * Re-exports src/model-pricing.ts (pure module, no Node deps) so backend and
 * dashboard share ONE source of truth, plus display-oriented helpers.
 */

export * from '../../../src/model-pricing'

import { pricingFor } from '../../../src/model-pricing'

/** Blended $/M (~70% input / 30% output) for estimates and display. */
export function blendedPerM(model?: string): number {
  const p = pricingFor(model)
  return p.input * 0.7 + p.output * 0.3
}

/** Cache saving $/M = full input price − cache-read price. */
export function cacheSavingsPerM(model?: string): number {
  const p = pricingFor(model)
  return p.input - p.cacheRead
}

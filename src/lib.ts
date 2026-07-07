/**
 * lib.ts — Public library API for @statforge/claudestat
 *
 * @experimental v1.13.0 — Surface may change in any minor/patch release until v2.0.0.
 * See docs/LIBRARY.md for usage examples.
 *
 * Re-exports pure analysis/pricing modules and the read-only dbOps namespace.
 * dbOps is proxied via lib-guard so that the first read triggers a daemon
 * health check (configurable via configure()).
 */

import { dbOps as _dbOps } from './db'
import { wrapDbOps } from './lib-guard'

// Proxied dbOps — triggers checkDaemonOrThrow() on first property access
export const dbOps = wrapDbOps(_dbOps)

export { configure } from './lib-guard'
export { DaemonNotRunningError } from './lib-guard'

// ─── Read-only types from db.ts ────────────────────────────────────────────────
export type {
  SessionRow,
  AssistantTurnRow,
  EventRow,
  BlockCostEntry,
  CostUpdate,
  BillingBlock,
  DailyActivity,
  DailySummary,
  OrchRunRow,
} from './db'

// ─── model-pricing.ts (pure) ─────────────────────────────────────────────────
export {
  findPricing,
  estimateCost,
  estimateTokensFromToolCounts,
  MODEL_PRICING,
} from './model-pricing'
export type { ModelPrice } from './model-pricing'

// ─── pricing.ts (pure — Claude Code-specific) ───────────────────────────────
export {
  getContextWindow,
  KNOWN_CONTEXT_WINDOWS,
  PRICING,
} from './pricing'
export type { ModelPricing } from './pricing'

// ─── intelligence.ts (pure) ─────────────────────────────────────────────────
export {
  analyzeSession,
  detectLoops,
  calcEfficiencyScore,
  detectExactRetries,
  computeErrorRate,
  computeFileChurn,
  detectSeqCycles,
  predictSaturation,
} from './intelligence'
export type {
  LoopAlert,
  LoopContext,
  IntelligenceReport,
  SaturationPrediction,
} from './intelligence'

// ─── pattern-analyzer.ts (pure) ──────────────────────────────────────────────
export { analyzePatterns } from './pattern-analyzer'
export type {
  PatternInsight,
  SessionStats,
  RecentExtremes,
  SourceStat,
} from './pattern-analyzer'

// ─── cost-projector.ts (pure) ────────────────────────────────────────────────
export { computeProjection } from './cost-projector'
export type {
  CostProjection,
  PeriodProjection,
  DayPoint,
} from './cost-projector'

// ─── insights.ts (Synchronous DB-backed aggregations) ────────────────────────
export {
  getWeeklyInsightData,
  getUsageInsights,
} from './insights'
export type {
  WeeklyInsightData,
  UsageInsightsData,
} from './insights'

// ─── quota-tracker.ts (Synchronous quota computation) ───────────────────────
export { computeQuota } from './quota-tracker'
export type { QuotaData } from './quota-tracker'
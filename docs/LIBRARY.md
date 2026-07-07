# `@statforge/claudestat` — Programmatic Library API

> **⚠️ @experimental (v1.13.0) — the public library surface may change in any minor or patch
> release until v2.0.0.** Pin to exact versions (`"@statforge/claudestat": "1.13.0"`)
> until the API stabilizes.

claudestat v1.13.0+ exposes a stable-ish TypeScript library entry in addition to the `claudestat` CLI.
You can now read sessions, tokens, costs, and intelligence signals programmatically — no `spawn`,
no output parsing.

## Quick start

```ts
import {
  dbOps,
  findPricing,
  estimateCost,
  analyzeSession,
  computeProjection,
  computeQuota,
  configure,
} from '@statforge/claudestat'

// Opt out of the daemon-required guard (for CI / batch jobs that accept stale data):
configure({ throwOnNoDaemon: false })
```

By default, **the first `dbOps.*` call probes `http://127.0.0.1:7337/health`** and throws
`DaemonNotRunningError` if the daemon is down. Pure functions (`findPricing`, `analyzeSession`,
`computeProjection`, etc.) never probe and work regardless.

## Examples

### 1 — Recent sessions

```ts
import { dbOps } from '@statforge/claudestat'

const sessions = dbOps.getAllSessions(20)
for (const s of sessions) {
  console.log(`${s.id} · ${s.source} · $${(s.total_cost_usd ?? 0).toFixed(2)} · ${s.started_at}`)
}
```

### 2 — Loop detection over a session's events

```ts
import { dbOps, analyzeSession } from '@statforge/claudestat'

const [session] = dbOps.getAllSessions(1)
if (session) {
  const events = dbOps.getSessionEvents(session.id)
  const report = analyzeSession(events, session.total_cost_usd ?? 0)
  console.log(`Loops: ${report.loopsDetected} · Efficiency: ${report.efficiencyScore.toFixed(2)}`)
}
```

### 3 — 30-day cost forecast

```ts
import { computeProjection } from '@statforge/claudestat'

const proj = computeProjection(30)
console.log(`Projected 30-day cost: $${proj.projectedCost.toFixed(2)}`)
```

## Daemon guard

| Situation | Default | With `configure({throwOnNoDaemon:false})` or `CLAUDESTAT_LIB_THROW_ON_NO_DAEMON=0` |
|---|---|---|
| First `dbOps.*` call, daemon down | Throws `DaemonNotRunningError` | Logs `console.warn` + reads stale-but-present data |
| Pure-function call (no `dbOps`) | Never probes | Never probes |
| Subsequent `dbOps.*` calls | Cached — no re-probe | Same |

The check uses `curl -s -m 1 http://127.0.0.1:${PORT}/health` (synchronous, ~10 ms).
If `curl` is missing from the host, the check is skipped with a warning.

### Configurable port

The daemon port resolves from (in priority order):
1. `CLAUDESTAT_DAEMON_PORT` environment variable
2. `readConfig().port` from `~/.claudestat/config.json` (default `7337`)

## Available surface (v1.13.0)

**`dbOps` (read-only)** — `getSession`, `getLatestSession`, `getAllSessions(limit?)`,
`getSessionsInRange(startMs, endMs)`, `getSessionEvents(id)`, `getSessionEventsRecent(id, limit?)`,
`getRecentSessions(days?)`, `getTopTools(...)`, `getToolCountsForSession(id)`,
`getToolCountsByRange(s, e, source?)`, `getDailyActivity(days?)`, `getModelBreakdown(days?)`,
`getProjectCosts(days?)`, `getQuotaStats(sinceMs)`, `getDbStats()`.

**Pricing** — `findPricing`, `estimateCost`, `estimateTokensFromToolCounts`,
`getContextWindow`, `MODEL_PRICING`, `KNOWN_CONTEXT_WINDOWS`, `PRICING`.

**Intelligence** — `analyzeSession(events, cost?)`, `detectLoops`,
`calcEfficiencyScore`, `detectExactRetries`, `computeErrorRate`, `computeFileChurn`,
`detectSeqCycles`, `predictSaturation`, `analyzePatterns`.

**Forecasting & quota** — `computeProjection(days?)`, `getWeeklyInsightData(days?)`,
`getUsageInsights(days?)`, `computeQuota(forcePlan?)`.

**Types** — `SessionRow`, `EventRow`, `BlockCostEntry`, `BillingBlock`, `DailyActivity`,
`DailySummary`, `OrchRunRow`, `ModelPrice`, `ModelPricing`, `IntelligenceReport`, `LoopAlert`,
`LoopContext`, `SaturationPrediction`, `PatternInsight`, `CostProjection`, `QuotaData`,
`WeeklyInsightData`, `UsageInsightsData`.

**Subpaths** —
- `@statforge/claudestat` (default — see exports above)
- `@statforge/claudestat/advanced` (same surface; reserved for divergence in v1.14.0)
- `@statforge/claudestat/cli` (the `claudestat` executable)
- `@statforge/claudestat/mcp` (the MCP stdio server)

## Out-of-scope for v1.13.0

- Async JSONL readers (`getAllBlockCostsForSession`, `getSessionPrompts`) — coming in v1.14.0
- MCP server factory (`createMcpServer({tools?})`) — coming in v1.15.0
- DB write-mutations surface — public surface stays read-only

See the project roadmap in [`../HANDOFF.md`](../HANDOFF.md) for future plans.
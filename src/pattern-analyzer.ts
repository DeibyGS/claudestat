/**
 * pattern-analyzer.ts — Detects inefficiency patterns in Claude Code usage.
 *
 * Pure logic module: receives pre-fetched DB data, returns actionable insights.
 * No DB or filesystem access here — easier to test and reason about.
 *
 * Patterns detected:
 *   - Read dominance   → suggest offset+limit or batching
 *   - Bash overuse     → suggest Read/Grep instead
 *   - High loop rate   → review prompts / agent instructions
 *   - Low cache ratio  → context changes too much between messages
 *   - High cache ratio → positive: great cost efficiency
 *   - High avg cost    → consider Haiku for simpler tasks
 *   - Low efficiency   → linked to loops
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type InsightLevel = 'tip' | 'warning' | 'positive'

export interface PatternInsight {
  level:       InsightLevel
  title:       string
  description: string
  metric?:     string   // the value that triggered this (e.g. "42% de las llamadas")
}

export interface ToolCount {
  tool_name: string
  count:     number
}

export interface SessionStats {
  session_count:   number
  avg_cache_read:  number
  avg_total_input: number   // input + cache_read
  avg_loops:       number
  avg_cost_usd:    number
  avg_efficiency:  number
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

const MIN_SESSIONS  = 2     // need at least 2 sessions for meaningful patterns
const MIN_TOOLS     = 15    // need at least 15 tool calls total to trust ratios

// ─── Analyzer ────────────────────────────────────────────────────────────────

export function analyzePatterns(
  toolCounts: ToolCount[],
  stats: SessionStats,
): PatternInsight[] {
  const insights: PatternInsight[] = []

  if (stats.session_count < MIN_SESSIONS) return insights

  const totalTools = toolCounts.reduce((s, t) => s + t.count, 0)
  if (totalTools < MIN_TOOLS) return insights

  const byName = new Map(toolCounts.map(t => [t.tool_name, t.count]))
  const get    = (name: string) => byName.get(name) ?? 0

  // ── Read dominance ────────────────────────────────────────────────────────
  const readCount = get('Read')
  const readPct   = Math.round(readCount / totalTools * 100)
  if (readPct >= 45 && readCount >= 20) {
    insights.push({
      level:       'tip',
      title:       'High Read frequency',
      description: 'More than 40% of tool calls are Read. Consider using offset+limit to read only the needed lines, or batch reads of multiple files in a single response.',
      metric:      `${readPct}% of calls (${readCount} uses)`,
    })
  }

  // ── Bash overuse vs Read/Grep ─────────────────────────────────────────────
  const bashCount  = get('Bash')
  const readGrep   = get('Read') + get('Grep') + get('Glob')
  const bashPct    = Math.round(bashCount / totalTools * 100)
  if (bashCount > readGrep && bashCount >= 10) {
    insights.push({
      level:       'tip',
      title:       'Bash used more than Read/Grep',
      description: 'Bash can do the same as cat, grep or find, but is slower and less transparent. Dedicated tools (Read, Grep, Glob) are safer and faster for Claude.',
      metric:      `${bashPct}% Bash (${bashCount}) vs ${readGrep} Read+Grep+Glob`,
    })
  }

  // ── High loop rate ────────────────────────────────────────────────────────
  if (stats.avg_loops >= 1.5) {
    insights.push({
      level:       'warning',
      title:       'Frequent loops detected',
      description: 'Claude repeats the same tools in a loop more than 1.5 times per session on average. This usually indicates ambiguous instructions or an unnecessary confirmation cycle.',
      metric:      `~${stats.avg_loops.toFixed(1)} loops / session`,
    })
  }

  // ── Cache efficiency ──────────────────────────────────────────────────────
  const cacheRatio = stats.avg_total_input > 0
    ? stats.avg_cache_read / stats.avg_total_input
    : 0

  if (cacheRatio < 0.15 && stats.avg_total_input > 5_000) {
    insights.push({
      level:       'tip',
      title:       'Low cache reuse',
      description: 'Only 15% or less of the context comes from cache. The context varies a lot between messages. If there are fixed instructions (CLAUDE.md, long system prompts), Claude reprocesses them on every response.',
      metric:      `${Math.round(cacheRatio * 100)}% cache hit ratio`,
    })
  } else if (cacheRatio >= 0.65 && stats.avg_total_input > 5_000) {
    insights.push({
      level:       'positive',
      title:       'Excellent cache usage',
      description: 'More than 65% of the context is served from cache in this project. A large portion of input cost is avoided thanks to Claude prompt caching.',
      metric:      `${Math.round(cacheRatio * 100)}% cache hit ratio`,
    })
  }

  // ── High average cost per session ─────────────────────────────────────────
  if (stats.avg_cost_usd >= 0.50) {
    insights.push({
      level:       'tip',
      title:       'High cost per session',
      description: 'The average cost per session exceeds $0.50. If there are repetitive analysis or file reading tasks, consider using Haiku (10× cheaper) for those parts.',
      metric:      `~$${stats.avg_cost_usd.toFixed(2)} / session`,
    })
  }

  // ── Low efficiency score ──────────────────────────────────────────────────
  if (stats.avg_efficiency !== null && stats.avg_efficiency < 65) {
    insights.push({
      level:       'warning',
      title:       'Low efficiency score',
      description: 'The average efficiency score is below 65/100. This is correlated with high loop counts. Check if prompts provide enough context on the first attempt.',
      metric:      `${Math.round(stats.avg_efficiency)}/100 average`,
    })
  }

  // ── Heavy context per session ─────────────────────────────────────────────
  if (stats.avg_total_input > 150_000) {
    insights.push({
      level:       'tip',
      title:       'Very large context per session',
      description: 'The average context exceeds 150K tokens per session. Consider using /checkpoint + /compact frequently to reduce context size and lower the cost of each call.',
      metric:      `~${Math.round(stats.avg_total_input / 1000)}K tokens / session`,
    })
  }

  // ── Agent heavy usage (positive) ─────────────────────────────────────────
  const agentCount = get('Agent')
  const agentPct   = Math.round(agentCount / totalTools * 100)
  if (agentPct >= 20) {
    insights.push({
      level:       'positive',
      title:       'Heavy agent usage',
      description: 'More than 20% of calls are to Agent. This project makes good use of Claude Code multi-agent mode to parallelize tasks.',
      metric:      `${agentPct}% Agent (${agentCount} uses)`,
    })
  }

  return insights
}

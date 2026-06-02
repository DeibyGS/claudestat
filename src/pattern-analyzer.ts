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
 *   - Write vs Edit    → suggest Edit for incremental changes
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

// ─── Extra context types ──────────────────────────────────────────────────────

export interface RecentExtremes {
  heavy_loop_sessions: number   // sessions with 5+ loops in last 30 days
  recent_sessions:     number
  max_session_cost:    number
}

export interface SourceStat {
  avg_efficiency: number | null
  avg_loops:      number
  total_cost_usd: number
  session_count:  number
}

// ─── Analyzer ────────────────────────────────────────────────────────────────

export function analyzePatterns(
  toolCounts:     ToolCount[],
  stats:          SessionStats,
  recentExtremes?: RecentExtremes,
  sourceStats?:    Record<string, SourceStat>,
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
      description: `Read accounts for ${readPct}% of all tool calls (${readCount} uses). Use offset+limit for partial reads, or batch multiple files in a single response to cut redundant reads.`,
      metric:      `${readPct}% of calls · ${readCount} uses`,
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
      description: `Bash makes up ${bashPct}% of calls (${bashCount}) vs ${readGrep} combined Read+Grep+Glob. Dedicated tools are safer, faster, and more transparent for Claude.`,
      metric:      `${bashCount} Bash vs ${readGrep} Read+Grep+Glob`,
    })
  }

  // ── Heavy Write vs Edit ────────────────────────────────────────────────────
  const writeCount = get('Write')
  const editCount  = get('Edit')
  const writePct   = Math.round(writeCount / totalTools * 100)
  if (writeCount > editCount * 3 && writeCount >= 10) {
    insights.push({
      level:       'tip',
      title:       'Heavy Write vs Edit usage',
      description: `${writeCount} Write calls vs ${editCount} Edit calls (${writePct}% Write). Rewriting whole files costs more tokens than editing incrementally — prefer Edit for existing files.`,
      metric:      `${writeCount} writes vs ${editCount} edits`,
    })
  }

  // ── High loop rate ────────────────────────────────────────────────────────
  if (stats.avg_loops >= 1.5) {
    const heavySuffix = recentExtremes && recentExtremes.recent_sessions > 0
      ? ` ${recentExtremes.heavy_loop_sessions} of ${recentExtremes.recent_sessions} sessions in the last 30 days had 5+ loops.`
      : ''
    insights.push({
      level:       'warning',
      title:       'Frequent loops detected',
      description: `~${stats.avg_loops.toFixed(1)} loops per session on average — likely ambiguous instructions or unnecessary confirmation cycles.${heavySuffix}`,
      metric:      `~${stats.avg_loops.toFixed(1)} loops / session`,
    })
  }

  // ── Cache efficiency ──────────────────────────────────────────────────────
  const cacheRatio = stats.avg_total_input > 0
    ? stats.avg_cache_read / stats.avg_total_input
    : 0
  const cachePct = Math.round(cacheRatio * 100)

  if (cacheRatio < 0.15 && stats.avg_total_input > 5_000) {
    insights.push({
      level:       'tip',
      title:       'Low cache reuse',
      description: `Only ${cachePct}% of context comes from cache. The context changes too much between messages — fixed instructions (CLAUDE.md, system prompts) are being reprocessed on every call.`,
      metric:      `${cachePct}% cache hit ratio`,
    })
  } else if (cacheRatio >= 0.65 && stats.avg_total_input > 5_000) {
    insights.push({
      level:       'positive',
      title:       'Excellent cache usage',
      description: `${cachePct}% of context is served from cache — a large portion of input cost is being avoided. Prompt caching is working well for this project.`,
      metric:      `${cachePct}% cache hit ratio`,
    })
  }

  // ── High average cost per session ─────────────────────────────────────────
  if (stats.avg_cost_usd >= 0.50) {
    const maxNote = recentExtremes && recentExtremes.max_session_cost > 0
      ? ` Most expensive session in the last 30 days: $${recentExtremes.max_session_cost.toFixed(2)}.`
      : ''
    insights.push({
      level:       'tip',
      title:       'High cost per session',
      description: `Average session cost is $${stats.avg_cost_usd.toFixed(2)} — above the $0.50 threshold.${maxNote} Consider Haiku (10× cheaper) for repetitive reads or analysis tasks.`,
      metric:      `$${stats.avg_cost_usd.toFixed(2)} / session avg`,
    })
  }

  // ── Low efficiency score ──────────────────────────────────────────────────
  if (stats.avg_efficiency !== null && stats.avg_efficiency < 65) {
    insights.push({
      level:       'warning',
      title:       'Low efficiency score',
      description: `Average efficiency is ${Math.round(stats.avg_efficiency)}/100 — below the 65 threshold. This score penalizes loops, re-reads, and context bloat. Usually fixed by providing more context upfront.`,
      metric:      `${Math.round(stats.avg_efficiency)}/100 average`,
    })
  }

  // ── Heavy context per session ─────────────────────────────────────────────
  if (stats.avg_total_input > 150_000) {
    insights.push({
      level:       'tip',
      title:       'Very large context per session',
      description: `Average context is ~${Math.round(stats.avg_total_input / 1000)}K tokens per session. Run /checkpoint + /compact regularly to cut context and reduce per-call cost.`,
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
      description: `${agentPct}% of calls (${agentCount} uses) go to Agent — this project actively uses Claude Code multi-agent mode to parallelize work.`,
      metric:      `${agentPct}% Agent · ${agentCount} uses`,
    })
  }

  // ── Cross-tool comparison (CC vs OC) ─────────────────────────────────────
  if (sourceStats) {
    const cc = sourceStats['claude-code']
    const oc = sourceStats['opencode']
    if (cc && oc) {
      // Loop gap
      if (cc.avg_loops > 0 && oc.avg_loops > 0) {
        const loopRatio = cc.avg_loops / oc.avg_loops
        if (loopRatio >= 2) {
          insights.push({
            level:       'tip',
            title:       'CC has significantly more loops than OC',
            description: `Claude Code averages ${cc.avg_loops.toFixed(1)} loops/session vs OpenCode's ${oc.avg_loops.toFixed(1)}. CC sessions may benefit from clearer instructions or CLAUDE.md context.`,
            metric:      `${loopRatio.toFixed(1)}× more loops in CC`,
          })
        } else if (oc.avg_loops / cc.avg_loops >= 2) {
          insights.push({
            level:       'tip',
            title:       'OC has significantly more loops than CC',
            description: `OpenCode averages ${oc.avg_loops.toFixed(1)} loops/session vs Claude Code's ${cc.avg_loops.toFixed(1)}. Consider reviewing OC agent instructions for this project.`,
            metric:      `${(oc.avg_loops / cc.avg_loops).toFixed(1)}× more loops in OC`,
          })
        }
      }
      // Efficiency gap
      if (cc.avg_efficiency !== null && oc.avg_efficiency !== null) {
        const diff    = oc.avg_efficiency - cc.avg_efficiency
        const absDiff = Math.abs(diff)
        if (absDiff >= 15) {
          const better = diff > 0 ? 'OpenCode' : 'Claude Code'
          const worse  = diff > 0 ? 'Claude Code' : 'OpenCode'
          const betterVal = diff > 0 ? oc.avg_efficiency : cc.avg_efficiency
          const worseVal  = diff > 0 ? cc.avg_efficiency : oc.avg_efficiency
          insights.push({
            level:       'tip',
            title:       `${better} more efficient for this project`,
            description: `${better} scores ${betterVal}/100 vs ${worse}'s ${worseVal}/100 — a ${absDiff}-point gap. The less efficient tool may have weaker instructions or a less suited workflow.`,
            metric:      `${absDiff} point gap · ${better} wins`,
          })
        }
      }
    }
  }

  return insights
}

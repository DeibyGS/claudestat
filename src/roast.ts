import { dbOps } from './db.js'

interface RoastData {
  totalCost: number
  totalSessions: number
  totalBashCalls: number
  totalLoops: number
  avgEfficiency: number
  contextHits: number
  days: number
  totalTokens: number
  avgCostPerSession: number
  topTool: string
  topToolPct: number
}

function getRoastRating(avgEfficiency: number): string {
  if (avgEfficiency >= 90) return "You're a machine. Or maybe you're just not using Claude enough."
  if (avgEfficiency >= 70) return "Solid. Not great, not terrible. The AI equivalent of a C+ student."
  if (avgEfficiency >= 50) return "Room for growth, champ."
  return "Oof. That's a lot of money down the drain. Are you okay?"
}

function getRoastCards(data: RoastData): string[] {
  const cards: string[] = []

  if (data.totalBashCalls > 0) {
    const minutesPerCall = (data.days * 24 * 60) / data.totalBashCalls
    if (minutesPerCall < 60) {
      cards.push(
        `  🖥️  BASH OVERLOAD\n` +
        `  ${data.totalBashCalls} calls in ${data.days}d — once every ${minutesPerCall.toFixed(1)} min\n` +
        `  Are you okay?`
      )
    }
  }

  if (data.contextHits > 0) {
    cards.push(
      `  🧠  CONTEXT AMNESIA\n` +
      `  ${data.contextHits} sessions at 90%+ context\n` +
      `  Claude was writing with amnesia half the time.`
    )
  }

  if (data.totalLoops > 0) {
    const loopCost = data.totalCost * 0.15
    const coffees = Math.floor(loopCost / 0.3)
    cards.push(
      `  🔄  LOOP MONEY PIT\n` +
      `  $${loopCost.toFixed(2)} wasted on loops${coffees > 0 ? ` — that's ${coffees} coffees` : ''}\n` +
      `  Just saying.`
    )
  }

  return cards
}

export async function runRoast(opts: { stats: boolean; months: number }) {
  const days = opts.months ?? 30
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000

  const sessions = dbOps.getAllSessions(500).filter(s => s.started_at >= sinceMs)

  let totalBashCalls = 0
  let totalLoops = 0
  let contextHits = 0
  let totalTokens = 0

  for (const session of sessions) {
    totalLoops += session.loops_detected || 0
    totalTokens += (session.total_input_tokens || 0) + (session.total_output_tokens || 0) + (session.total_cache_read || 0)
    if ((session.total_input_tokens || 0) + (session.total_output_tokens || 0) > 150000) {
      contextHits++
    }

    const events = dbOps.getSessionEvents(session.id)
    const bashCalls = events.filter(e => e.type === 'Done' && e.tool_name === 'Bash').length
    totalBashCalls += bashCalls
  }

  const totalCost = sessions.reduce((a, s) => a + (s.total_cost_usd || 0), 0)
  const avgEfficiency = sessions.length > 0
    ? sessions.reduce((a, s) => a + (s.efficiency_score || 0), 0) / sessions.length
    : 100
  const avgCostPerSession = sessions.length > 0 ? totalCost / sessions.length : 0

  const topTools = dbOps.getTopTools(days, 'cost', 1)
  const topTool = topTools[0]?.tool_name ?? 'Unknown'
  const topToolPct = totalCost > 0 ? Math.round((topTools[0]?.total_cost_usd ?? 0) / totalCost * 100) : 0

  const data: RoastData = {
    totalCost,
    totalSessions: sessions.length,
    totalBashCalls,
    totalLoops,
    avgEfficiency,
    contextHits,
    days,
    totalTokens,
    avgCostPerSession,
    topTool,
    topToolPct,
  }

  const R = '\x1b[0m'
  const B = '\x1b[1m'
  const D = '\x1b[2m'
  const G = '\x1b[32m'
  const Y = '\x1b[33m'
  const C = '\x1b[36m'
  const M = '\x1b[35m'

  const bar = (pct: number, width = 20): string => {
    const filled = Math.round(Math.min(pct, 100) / 100 * width)
    const color = pct >= 90 ? '\x1b[31m' : pct >= 70 ? '\x1b[33m' : '\x1b[32m'
    return `${color}${'█'.repeat(filled)}${R}${D}${'░'.repeat(width - filled)}${R}`
  }

  const fmtTok = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`
    return n.toString()
  }

  if (opts.stats) {
    const effPct = Math.round(avgEfficiency)

    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
    const padVisual = (s: string, target: number) => {
      const visible = stripAnsi(s).length
      return s + ' '.repeat(Math.max(0, target - visible))
    }

    const rows = [
      { label: 'Sessions',   value: `${B}${sessions.length}${R}`,         barPct: Math.min(sessions.length / 50 * 100, 100) },
      { label: 'Total cost', value: `${B}$${totalCost.toFixed(2)}${R}`,   barPct: Math.min(totalCost / 200 * 100, 100) },
      { label: 'Bash calls', value: `${B}${totalBashCalls}${R}`,          barPct: Math.min(totalBashCalls / 500 * 100, 100) },
      { label: 'Loops',      value: `${B}${totalLoops}${R}`,              barPct: Math.min(totalLoops / 200 * 100, 100) },
      { label: 'Efficiency', value: `${B}${effPct}/100${R}`,              barPct: effPct },
    ]

    const lines: string[] = []
    lines.push(`\n${B}📊 Claude Code Stats${R}  ${D}(${days} days)${R}`)
    lines.push('━'.repeat(42))
    lines.push('')

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const labelCol = `  ${r.label}`.padEnd(14)
      const valueCol = padVisual(r.value, 12)
      lines.push(`${labelCol}${valueCol}${bar(r.barPct)}`)
      if (i < rows.length - 1) lines.push('')
    }

    lines.push('')
    console.log(lines.join('\n'))
    return
  }

  const rating = Math.round(avgEfficiency)
  const stars = rating >= 90 ? '★★★★★' : rating >= 70 ? '★★★★☆' : rating >= 50 ? '★★★☆☆' : '★★☆☆☆'

  const lines: string[] = []
  lines.push(`\n${B}🔥 Your Claude Code Roast${R}  ${D}(${days} days)${R}`)
  lines.push('━'.repeat(44))
  lines.push('')

  lines.push(`  ${B}Score${R}  ${bar(rating)}  ${B}${rating}/100${R}  ${Y}${stars}${R}`)
  lines.push('')

  lines.push(`  ${B}Scorecard${R}`)
  lines.push(`  ┌─────────────────┬──────────────┬──────────────┐`)
  lines.push(`  │ ${D}Metric${R}            │ ${D}Value${R}          │ ${D}Rating${R}         │`)
  lines.push(`  ├─────────────────┼──────────────┼──────────────┤`)

  const sessionLabel = `${data.totalSessions}`
  const sessionRating = data.totalSessions > 30 ? `${Y}prolific${R}` : `${G}normal${R}`
  lines.push(`  │ Sessions        │ ${sessionLabel.padEnd(12)} │ ${sessionRating}`.padEnd(46) + '│')

  const costLabel = `$${totalCost.toFixed(2)}`
  const costRating = totalCost > 100 ? `${Y}💸 burning${R}` : totalCost > 20 ? `${G}reasonable${R}` : `${G}frugal${R}`
  lines.push(`  │ Total cost      │ ${costLabel.padEnd(12)} │ ${costRating}`.padEnd(46) + '│')

  const avgLabel = `$${avgCostPerSession.toFixed(2)}/session`
  const avgRating = avgCostPerSession > 10 ? `${Y}expensive${R}` : `${G}efficient${R}`
  lines.push(`  │ Avg/session     │ ${avgLabel.padEnd(12)} │ ${avgRating}`.padEnd(46) + '│')

  const bashLabel = `${totalBashCalls}`
  const bashRating = totalBashCalls > 200 ? `${Y}🔨 overload${R}` : `${G}normal${R}`
  lines.push(`  │ Bash calls      │ ${bashLabel.padEnd(12)} │ ${bashRating}`.padEnd(46) + '│')

  const loopLabel = `${totalLoops}`
  const loopRating = totalLoops > 50 ? `${Y}🔄 looping${R}` : `${G}clean${R}`
  lines.push(`  │ Loops           │ ${loopLabel.padEnd(12)} │ ${loopRating}`.padEnd(46) + '│')

  const effLabel = `${Math.round(avgEfficiency)}/100`
  const effRating = avgEfficiency >= 90 ? `${G}🏆 elite${R}` : avgEfficiency >= 70 ? `${Y}decent${R}` : `${Y}needs work${R}`
  lines.push(`  │ Efficiency      │ ${effLabel.padEnd(12)} │ ${effRating}`.padEnd(46) + '│')

  const tokLabel = fmtTok(totalTokens)
  lines.push(`  │ Tokens          │ ${tokLabel.padEnd(12)} │ ${D}—${R}`.padEnd(46) + '│')

  const toolLabel = `${topTool} ${topToolPct}%`
  lines.push(`  │ Top tool        │ ${toolLabel.padEnd(12)} │ ${D}—${R}`.padEnd(46) + '│')

  lines.push(`  └─────────────────┴──────────────┴──────────────┘`)
  lines.push('')

  const cards = getRoastCards(data)
  if (cards.length > 0) {
    lines.push(`  ${B}Roast Cards${R}`)
    lines.push('')
    for (const card of cards) {
      const cardLines = card.split('\n')
      const maxLen = Math.max(...cardLines.map(l => l.length))
      lines.push(`  ┌${'─'.repeat(maxLen + 2)}┐`)
      for (const cl of cardLines) {
        lines.push(`  │ ${cl.padEnd(maxLen)} │`)
      }
      lines.push(`  └${'─'.repeat(maxLen + 2)}┘`)
      lines.push('')
    }
  }

  lines.push(`  ${B}Verdict${R}`)
  lines.push(`  ${getRoastRating(avgEfficiency)}`)
  lines.push('')
  lines.push('━'.repeat(44))
  lines.push(`  ${D}github.com/DeibyGS/claudestat${R}`)
  lines.push('')
  console.log(lines.join('\n'))
}

import { dbOps } from './db.js'

interface RoastData {
  totalCost: number
  totalSessions: number
  totalBashCalls: number
  totalLoops: number
  avgEfficiency: number
  contextHits: number
  days: number
}

function formatMinutes(totalMinutes: number): string {
  if (totalMinutes < 60) return `${Math.round(totalMinutes)} minutes`
  const hours = Math.floor(totalMinutes / 60)
  if (hours < 24) return `${hours} hours`
  const days = Math.floor(hours / 24)
  return `${days} days`
}

function getRoastRating(avgEfficiency: number): string {
  if (avgEfficiency >= 90) return "You're a machine. Or maybe you're just not using Claude enough. 😏"
  if (avgEfficiency >= 70) return "Solid. Not great, not terrible. The AI equivalent of a C+ student."
  if (avgEfficiency >= 50) return "Room for growth, champ. 📈"
  return "Oof. That's a lot of money down the drain. Are you okay? 💀"
}

function getRoastMessage(data: RoastData): string {
  const lines: string[] = []
  lines.push('🔥 Your Claude Code Roast')
  lines.push('')

  if (data.totalBashCalls > 0) {
    const minutesPerCall = (data.days * 24 * 60) / data.totalBashCalls
    if (minutesPerCall < 60) {
      lines.push(`  You called Bash ${data.totalBashCalls} times in ${data.days} days.`)
      lines.push(`  That's once every ${minutesPerCall.toFixed(1)} minutes.`)
      lines.push('  Are you okay?')
      lines.push('')
    }
  }

  if (data.contextHits > 0) {
    lines.push(`  You hit 90%+ context in ${data.contextHits} sessions.`)
    lines.push('  Claude was writing with amnesia half the time.')
    lines.push('')
  }

  if (data.totalLoops > 0) {
    const loopCost = data.totalCost * 0.15
    lines.push(`  You spent $${loopCost.toFixed(2)} on loops you never noticed.`)
    const coffees = Math.floor(loopCost / 0.3)
    if (coffees > 0) {
      lines.push(`  That's ${coffees} coffees. Just saying.`)
      lines.push('')
    }
  }

  lines.push(`  Efficiency score: ${Math.round(data.avgEfficiency)}/100`)
  lines.push(`  ${getRoastRating(data.avgEfficiency)}`)

  return lines.join('\n')
}

export async function runRoast(opts: { stats: boolean; months: number }) {
  const days = opts.months ?? 30
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000

  const sessions = dbOps.getAllSessions(500).filter(s => s.started_at >= sinceMs)

  let totalBashCalls = 0
  let totalLoops = 0
  let contextHits = 0

  for (const session of sessions) {
    totalLoops += session.loops_detected || 0
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

  const data: RoastData = {
    totalCost,
    totalSessions: sessions.length,
    totalBashCalls,
    totalLoops,
    avgEfficiency,
    contextHits,
    days,
  }

  if (opts.stats) {
    console.log(`=== Claude Code Stats (${days} days) ===`)
    console.log(`Sessions: ${sessions.length}`)
    console.log(`Total cost: $${totalCost.toFixed(2)}`)
    console.log(`Bash calls: ${totalBashCalls}`)
    console.log(`Loops: ${totalLoops}`)
    console.log(`Effficiency: ${Math.round(avgEfficiency)}/100`)
    return
  }

  console.log(getRoastMessage(data))
  console.log('')
  console.log('  github.com/DeibyGS/claudestat')
}
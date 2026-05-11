import { dbOps, type SessionRow, type EventRow } from './db.js'
import { spawn as spawnCb } from 'child_process'
import path from 'path'

interface SessionData {
  id: string
  project: string
  duration: string
  tools: number
  cost: string
  cacheSaved: string
  cachePct: number
  topTool: string
  topToolPct: number
  efficiency: number
  efficiencyEmoji: string
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const mins = minutes % 60
    return `${hours}h ${mins}m`
  }
  return `${minutes}m`
}

async function getSessionData(sessionId?: string): Promise<SessionData | null> {
  const sessions = dbOps.getAllSessions(1)
  let session: SessionRow | undefined

  if (sessionId) {
    session = dbOps.getSession(sessionId)
    if (!session) return null
  } else if (sessions.length > 0) {
    session = sessions[0]
  } else {
    return null
  }

  const events = dbOps.getSessionEvents(session.id)
  const toolCalls = events.filter((e: EventRow) => e.type === 'Done' && e.tool_name)

  const totalTokens = (session.total_input_tokens || 0) + (session.total_output_tokens || 0)
  const cacheTokens = (session.total_cache_read || 0) + (session.total_cache_creation || 0)
  const cacheSavedCost = (session.total_cost_usd || 0) * 0.1 * 0.9

  const toolCounts: Record<string, number> = {}
  toolCalls.forEach((e: EventRow) => {
    const tool = e.tool_name || 'Unknown'
    toolCounts[tool] = (toolCounts[tool] || 0) + 1
  })

  let topTool = '—'
  let topToolPct = 0
  if (Object.keys(toolCounts).length > 0) {
    const sorted = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])
    topTool = sorted[0][0]
    topToolPct = Math.round((sorted[0][1] / toolCalls.length) * 100)
  }

  const durationMs = (session.last_event_at || session.started_at) - session.started_at
  const project = path.basename(session.project_path ?? '') || 'unknown'

  return {
    id: session.id,
    project: project.length > 18 ? project.slice(0, 15) + '...' : project,
    duration: formatDuration(durationMs),
    tools: toolCalls.length,
    cost: `$${(session.total_cost_usd || 0).toFixed(2)}`,
    cacheSaved: `$${cacheSavedCost.toFixed(2)}`,
    cachePct: Math.min(100, totalTokens > 0 ? Math.round((cacheTokens / totalTokens) * 100) : 0),
    topTool: topTool.length > 12 ? topTool.slice(0, 9) + '...' : topTool,
    topToolPct,
    efficiency: session.efficiency_score || 100,
    efficiencyEmoji: (session.efficiency_score || 100) >= 90 ? '🔥' : (session.efficiency_score || 100) >= 70 ? '👍' : '💀',
  }
}

function generateAsciiCard(data: SessionData): string {
  const FIELD_WIDTH = 25
  const toolsLabel = `${data.tools} calls`
  const cacheLabel = `${data.cachePct}% saved (${data.cacheSaved})`
  const topLabel = `${data.topTool} (${data.topToolPct}%)`
  const effLabel = `${data.efficiency} / 100 ${data.efficiencyEmoji}`
  
  const lines = [
    '╔═══════════════════════════════════╗',
    '║     Session Report · claudestat   ║',
    '╠═══════════════════════════════════╣',
    `║  Project     ${data.project.padEnd(FIELD_WIDTH)}║`,
    `║  Duration   ${data.duration.padEnd(FIELD_WIDTH)}║`,
    `║  Tools      ${toolsLabel.padEnd(FIELD_WIDTH)}║`,
    `║  Cost       ${data.cost.padEnd(FIELD_WIDTH)}║`,
    `║  Cache hit  ${cacheLabel.padEnd(FIELD_WIDTH)}║`,
    `║  Top tool  ${topLabel.padEnd(FIELD_WIDTH)}║`,
    `║  Efficiency ${effLabel.padEnd(FIELD_WIDTH)}║`,
    '╚═══════════════════════════════════╝',
    '  github.com/DeibyGS/claudestat',
  ]
  return lines.join('\n')
}

function generateJson(data: SessionData): string {
  return JSON.stringify({
    project: data.project,
    duration: data.duration,
    tools: data.tools,
    cost: data.cost,
    cache_saved: data.cacheSaved,
    cache_pct: data.cachePct,
    top_tool: data.topTool,
    top_tool_pct: data.topToolPct,
    efficiency: data.efficiency,
  }, null, 2)
}

export async function runShare(args: {
  sessionId?: string
  format: 'ascii' | 'json'
  copy: boolean
}) {
  const data = await getSessionData(args.sessionId)

  if (!data) {
    console.error('Error: No sessions found. Run Claude Code first.')
    process.exit(1)
  }

  const output = args.format === 'json' ? generateJson(data) : generateAsciiCard(data)
  console.log(output)

  if (args.copy) {
    try {
      const p = spawnCb('pbcopy', [], { stdio: ['pipe', process.stderr, process.stderr] })
      ;(p.stdin as any).write(output)
      ;(p.stdin as any).end()
      p.on('close', () => console.log('\n✓ Copied to clipboard'))
    } catch {
      console.warn('⚠ Clipboard not available (macOS only)')
    }
  }
}
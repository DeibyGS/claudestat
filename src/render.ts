/**
 * render.ts — Renderizado del trace tree en terminal (Phase 2)
 *
 * Novedades vs Phase 1:
 * - Muestra coste real en el footer (cuando el enricher lo actualiza)
 * - Muestra loops detectados con alerta visual
 * - Muestra efficiency score con color por rango
 * - Input/output/cache tokens desglosados
 */

const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Write: '✏️',  Edit: '✏️',  Bash: '🖥️',
  Glob: '🔍', Grep: '🔎',  WebSearch: '🌐', WebFetch: '🌐',
  Agent: '🤖', Skill: '⚡', TodoWrite: '📝', TodoRead: '📝',
  Task: '📋',  default: '🔧'
}

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  red:    '\x1b[31m',
  gray:   '\x1b[90m',
}

export interface TraceEvent {
  type: string
  tool_name?: string
  tool_input?: string
  ts: number
  duration_ms?: number
  session_id?: string
  cwd?: string
}

export interface LoopAlert {
  toolName: string
  count: number
  ts: number
}

export interface CostInfo {
  cost_usd: number
  input_tokens: number
  output_tokens: number
  cache_read: number
  cache_creation: number
  efficiency_score: number
  loops: LoopAlert[]
  summary?: string
}

export interface RenderState {
  sessionId: string
  cwd: string
  startedAt: number
  events: TraceEvent[]
  cost?: CostInfo
}

function relTs(base: number, ts: number): string {
  const diff = ts - base
  const s    = Math.floor(diff / 1000)
  const ms   = diff % 1000
  return `${String(s).padStart(2, '0')}:${String(ms).padStart(3, '0')}`
}

function fmtMs(ms?: number): string {
  if (!ms) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)
}

function trunc(s: string, n = 52): string {
  return s.length > n ? s.slice(0, n - 3) + '...' : s
}

function detail(toolName?: string, rawInput?: string): string {
  if (!toolName || !rawInput) return ''
  try {
    const inp = JSON.parse(rawInput)
    if (['Read','Write','Edit'].includes(toolName))   return trunc(inp.file_path || inp.path || '')
    if (toolName === 'Bash')                           return trunc(inp.command || '')
    if (['Glob','Grep'].includes(toolName))            return trunc(inp.pattern || inp.query || '')
    if (['WebSearch','WebFetch'].includes(toolName))   return trunc(inp.query || inp.url || '')
    if (toolName === 'Agent')                          return trunc((inp.prompt || '').slice(0, 40))
  } catch {}
  return ''
}

function scoreColor(score: number): string {
  if (score >= 90) return C.green
  if (score >= 70) return C.yellow
  return C.red
}

export function renderTrace(state: RenderState): string {
  const { sessionId, cwd, startedAt, events, cost } = state
  const lines: string[] = []

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push('')
  lines.push(
    `${C.bold}● claudetrace${C.reset}  ` +
    `${C.dim}session:${C.reset} ${C.cyan}${sessionId.slice(0, 8)}${C.reset}  ` +
    `${C.dim}dir:${C.reset} ${C.blue}${cwd || '—'}${C.reset}`
  )

  // Alertas de loops (si hay) — aparecen en header para visibilidad máxima
  if (cost?.loops?.length) {
    for (const loop of cost.loops) {
      lines.push(`  ${C.red}⚠  Loop detectado: ${loop.toolName} llamado ${loop.count}x en 60s${C.reset}`)
    }
  }

  lines.push(C.dim + '─'.repeat(72) + C.reset)

  // ── Eventos ─────────────────────────────────────────────────────────────────
  for (const ev of events) {
    const ts  = `${C.gray}[${relTs(startedAt, ev.ts)}]${C.reset}`
    const det = detail(ev.tool_name, ev.tool_input)
    const ico = (TOOL_ICONS[ev.tool_name || ''] || '')

    if (ev.type === 'SessionStart') {
      lines.push(`  ${ts} 🔌 ${C.dim}Sesión iniciada${C.reset}`)

    } else if (ev.type === 'PreToolUse') {
      lines.push(
        `  ${ts} ${ico} ${C.yellow}${ev.tool_name}${C.reset}` +
        (det ? `  ${C.dim}${det}${C.reset}` : '') +
        `  ${C.dim}⟳ ejecutando...${C.reset}`
      )

    } else if (ev.type === 'Done') {
      lines.push(
        `  ${ts} ${ico} ${C.green}${ev.tool_name}${C.reset}` +
        (det ? `  ${C.dim}${det}${C.reset}` : '') +
        (ev.duration_ms ? `  ${C.dim}(${fmtMs(ev.duration_ms)})${C.reset}` : '')
      )

    } else if (ev.type === 'Stop') {
      lines.push(`  ${ts} ✅ ${C.green}Respuesta generada${C.reset}`)
    }
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  const toolsDone    = events.filter(e => e.type === 'Done').length
  const toolsPending = events.filter(e => e.type === 'PreToolUse').length
  const elapsed      = fmtMs(((events.at(-1)?.ts ?? startedAt) - startedAt))

  lines.push('')
  lines.push(C.dim + '─'.repeat(72) + C.reset)

  if (cost && cost.cost_usd > 0) {
    // Tenemos coste real — mostrar desglose completo
    const scoreStr = `${scoreColor(cost.efficiency_score)}${cost.efficiency_score}/100${C.reset}`
    const tokens =
      `in:${fmtTokens(cost.input_tokens)} ` +
      `out:${fmtTokens(cost.output_tokens)} ` +
      `cache✓:${fmtTokens(cost.cache_read)}`

    lines.push(
      ` ${C.dim}⏱${C.reset} ${elapsed}  ` +
      `${C.dim}✅${C.reset} ${toolsDone}  ` +
      `${C.bold}💰 $${cost.cost_usd.toFixed(4)}${C.reset}  ` +
      `${C.dim}tokens:${C.reset} ${C.dim}${tokens}${C.reset}  ` +
      `${C.dim}eficiencia:${C.reset} ${scoreStr}`
    )
  } else {
    // Aún sin coste (el enricher actualiza cuando Claude Code escribe el JSONL)
    lines.push(
      ` ${C.dim}⏱${C.reset} ${elapsed}   ` +
      `${C.dim}✅${C.reset} ${toolsDone} tools   ` +
      (toolsPending ? `${C.yellow}⟳ ${toolsPending} en curso${C.reset}   ` : '') +
      `${C.dim}💰 calculando coste...${C.reset}`
    )
  }

  lines.push('')
  return lines.join('\n')
}

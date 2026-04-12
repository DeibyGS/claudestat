/**
 * render.ts — Renderizado del trace tree en terminal (Phase 2 visual upgrade)
 *
 * Mejoras sobre Phase 1:
 * - Agrupa tool calls por bloque de respuesta (entre Stop events)
 * - Detecta modo por bloque: Claude directo / Con agentes / Con skills
 * - Barra visual de contexto (cuánto % del contexto está en uso)
 * - Barra visual de eficiencia
 * - Tokens en formato legible (K / M)
 * - Badge de loop por línea de tool repetido
 * - Coste y stats por bloque individual
 */

const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Write: '✏️',  Edit: '✏️',  Bash: '🖥️',
  Glob: '🔍', Grep: '🔎',  WebSearch: '🌐', WebFetch: '🌐',
  Agent: '🤖', Skill: '⚡', TodoWrite: '📝', TodoRead: '📝',
  Task: '📋',  default: '🔧'
}

const C = {
  reset:  '\x1b[0m', bold:   '\x1b[1m', dim:    '\x1b[2m',
  green:  '\x1b[32m', yellow: '\x1b[33m', blue:   '\x1b[34m',
  cyan:   '\x1b[36m', red:    '\x1b[31m', gray:   '\x1b[90m',
  bgRed:  '\x1b[41m',
}

// ─── Interfaces públicas ──────────────────────────────────────────────────────

export interface TraceEvent {
  type: string
  tool_name?: string
  tool_input?: string
  ts: number
  duration_ms?: number
  session_id?: string
  cwd?: string
}

export interface LoopAlert { toolName: string; count: number; ts: number }

export interface CostInfo {
  cost_usd: number
  input_tokens: number
  output_tokens: number
  cache_read: number
  cache_creation: number
  efficiency_score: number
  loops: LoopAlert[]
  summary?: string
  context_used?: number
  context_window?: number
}

export interface RenderState {
  sessionId: string
  cwd: string
  startedAt: number
  events: TraceEvent[]
  cost?: CostInfo
}

// ─── Helpers de formato ───────────────────────────────────────────────────────

function relTs(base: number, ts: number): string {
  const diff = ts - base
  const s = Math.floor(diff / 1000); const ms = diff % 1000
  return `${String(s).padStart(2,'0')}:${String(ms).padStart(3,'0')}`
}

function fmtMs(ms?: number): string {
  if (!ms) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

// Formatea tokens en K o M para legibilidad
function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function trunc(s: string, n = 48): string {
  return s.length > n ? s.slice(0, n - 3) + '...' : s
}

function detail(toolName?: string, rawInput?: string): string {
  if (!toolName || !rawInput) return ''
  try {
    const inp = JSON.parse(rawInput)
    if (['Read','Write','Edit'].includes(toolName))  return trunc(inp.file_path || inp.path || '')
    if (toolName === 'Bash')                          return trunc(inp.command || '')
    if (['Glob','Grep'].includes(toolName))           return trunc(inp.pattern || inp.query || '')
    if (['WebSearch','WebFetch'].includes(toolName))  return trunc(inp.query || inp.url || '')
    if (toolName === 'Agent')                         return trunc((inp.prompt || '').slice(0, 45))
    if (toolName === 'Skill')                         return trunc(inp.skill || inp.name || '')
  } catch {}
  return ''
}

// Barra de progreso visual: ████████░░░░  63%
function progressBar(pct: number, width = 18, color = C.cyan): string {
  const clamped = Math.max(0, Math.min(100, pct))
  const filled  = Math.round(clamped / 100 * width)
  const empty   = width - filled
  return `${color}${'█'.repeat(filled)}${C.dim}${'░'.repeat(empty)}${C.reset}`
}

// ─── Detección de modo por bloque ─────────────────────────────────────────────

type Mode = 'directo' | 'agentes' | 'skills' | 'agentes+skills'

function detectMode(tools: TraceEvent[]): Mode {
  const hasAgent = tools.some(e => e.tool_name === 'Agent')
  const hasSkill = tools.some(e => e.tool_name === 'Skill')
  if (hasAgent && hasSkill) return 'agentes+skills'
  if (hasAgent) return 'agentes'
  if (hasSkill) return 'skills'
  return 'directo'
}

function modeLabel(mode: Mode): string {
  const labels: Record<Mode, string> = {
    'directo':        `${C.dim}Claude directo${C.reset}`,
    'agentes':        `${C.yellow}🤖 Con agentes${C.reset}`,
    'skills':         `${C.cyan}⚡ Con skills${C.reset}`,
    'agentes+skills': `${C.yellow}🤖⚡ Agentes + skills${C.reset}`,
  }
  return labels[mode]
}

// ─── Agrupación por respuesta ─────────────────────────────────────────────────

interface ResponseBlock {
  index: number
  tools: TraceEvent[]
  stop?: TraceEvent
  mode: Mode
}

function groupByResponse(events: TraceEvent[]): ResponseBlock[] {
  const blocks: ResponseBlock[] = []
  let current: ResponseBlock = { index: 1, tools: [], mode: 'directo' }

  for (const ev of events) {
    if (ev.type === 'SessionStart') continue

    if (ev.type === 'Stop') {
      current.stop = ev
      current.mode = detectMode(current.tools)
      blocks.push(current)
      current = { index: blocks.length + 1, tools: [], mode: 'directo' }
    } else {
      current.tools.push(ev)
    }
  }

  // Bloque en curso (sin Stop todavía — Claude está respondiendo)
  if (current.tools.length > 0) {
    current.mode = detectMode(current.tools)
    blocks.push(current)
  }

  return blocks
}

// ─── Render principal ─────────────────────────────────────────────────────────

export function renderTrace(state: RenderState): string {
  const { sessionId, cwd, startedAt, events, cost } = state
  const lines: string[] = []

  // ── Header de sesión ──────────────────────────────────────────────────────
  lines.push('')
  lines.push(
    `${C.bold}● claudetrace${C.reset}  ` +
    `${C.dim}session:${C.reset} ${C.cyan}${sessionId.slice(0, 8)}${C.reset}  ` +
    `${C.dim}dir:${C.reset} ${C.blue}${cwd || '—'}${C.reset}`
  )

  // ── Barra de contexto ─────────────────────────────────────────────────────
  if (cost?.context_used && cost.context_window) {
    const pct     = Math.round(cost.context_used / cost.context_window * 100)
    const barColor = pct > 80 ? C.red : pct > 60 ? C.yellow : C.green
    const bar      = progressBar(pct, 24, barColor)
    const remaining = 100 - pct
    lines.push(
      `  ${C.dim}auto-compact en:${C.reset} ${bar}  ` +
      `${barColor}${remaining}% restante${C.reset}  ` +
      `${C.dim}${fmtTok(cost.context_used)} / ${fmtTok(cost.context_window)} tokens usados${C.reset}`
    )
  } else {
    lines.push(`  ${C.dim}contexto: calculando...${C.reset}`)
  }

  lines.push(C.dim + '─'.repeat(72) + C.reset)

  // ── Bloques de respuesta ──────────────────────────────────────────────────
  const blocks = groupByResponse(events)

  for (const block of blocks) {
    const isLast   = block.index === blocks.length
    const inProgress = !block.stop && isLast

    // Contar repeticiones de cada tool en este bloque (para badge de loop)
    const toolCount = new Map<string, number>()
    for (const t of block.tools) {
      if (t.tool_name) toolCount.set(t.tool_name, (toolCount.get(t.tool_name) || 0) + 1)
    }
    const isLooping = (name: string) => (toolCount.get(name) || 0) >= 3

    // Cabecera del bloque
    const blockHeader = inProgress
      ? `${C.yellow}⟳ Respuesta #${block.index}${C.reset}`
      : `${C.dim}Respuesta #${block.index}${C.reset}`

    lines.push(`  ${blockHeader}  ${modeLabel(block.mode)}`)

    // Tool calls del bloque
    for (const ev of block.tools) {
      const ts  = `${C.gray}[${relTs(startedAt, ev.ts)}]${C.reset}`
      const det = detail(ev.tool_name, ev.tool_input)
      const ico = TOOL_ICONS[ev.tool_name || ''] || TOOL_ICONS.default
      const loopBadge = ev.tool_name && isLooping(ev.tool_name)
        ? `  ${C.red}⚠ loop${C.reset}` : ''

      if (ev.type === 'PreToolUse') {
        lines.push(
          `    ${ts} ${ico} ${C.yellow}${ev.tool_name}${C.reset}` +
          (det ? `  ${C.dim}${det}${C.reset}` : '') +
          `  ${C.dim}⟳${C.reset}${loopBadge}`
        )
      } else if (ev.type === 'Done') {
        lines.push(
          `    ${ts} ${ico} ${C.green}${ev.tool_name}${C.reset}` +
          (det ? `  ${C.dim}${det}${C.reset}` : '') +
          (ev.duration_ms ? `  ${C.dim}(${fmtMs(ev.duration_ms)})${C.reset}` : '') +
          loopBadge
        )
      }
    }

    // Pie del bloque (solo si terminó)
    if (block.stop) {
      const toolsDone = block.tools.filter(e => e.type === 'Done').length
      const elapsed   = fmtMs(block.stop.ts - (block.tools[0]?.ts ?? block.stop.ts))
      lines.push(
        `    ${C.dim}└─ ✅ ${toolsDone} tools · ${elapsed}${C.reset}`
      )
    }

    lines.push('')
  }

  // ── Footer global ─────────────────────────────────────────────────────────
  lines.push(C.dim + '─'.repeat(72) + C.reset)

  if (cost && cost.cost_usd > 0) {
    // Alertas de loops
    if (cost.loops?.length) {
      for (const loop of cost.loops) {
        lines.push(`  ${C.red}⚠  Loop: ${loop.toolName} x${loop.count} en 60s${C.reset}`)
      }
    }

    // Barra de eficiencia
    const scoreColor = cost.efficiency_score >= 90 ? C.green
      : cost.efficiency_score >= 70 ? C.yellow : C.red
    const scoreBar = progressBar(cost.efficiency_score, 14, scoreColor)

    // Tokens
    const tokenLine =
      `${C.dim}↑${C.reset}${fmtTok(cost.input_tokens)} ` +
      `${C.dim}↓${C.reset}${fmtTok(cost.output_tokens)} ` +
      `${C.dim}🗄${C.reset}${fmtTok(cost.cache_read)}`

    lines.push(
      `  ${C.bold}💰 $${cost.cost_usd.toFixed(4)}${C.reset}   ` +
      `${tokenLine}   ` +
      `eficiencia: ${scoreBar} ${scoreColor}${cost.efficiency_score}/100${C.reset}`
    )
  } else {
    const totalDone = events.filter(e => e.type === 'Done').length
    const elapsed   = fmtMs((events.at(-1)?.ts ?? startedAt) - startedAt)
    lines.push(
      `  ${C.dim}⏱ ${elapsed}  ✅ ${totalDone} tools  💰 calculando...${C.reset}`
    )
  }

  lines.push('')
  return lines.join('\n')
}

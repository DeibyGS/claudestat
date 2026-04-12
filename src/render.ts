/**
 * render.ts — Renderizado del trace tree en terminal
 *
 * Usamos códigos ANSI directamente (sin librería) para mantener
 * zero dependencias en el renderer. Esto es intencional: el CLI
 * tiene que arrancar rápido y ser liviano.
 */

// Íconos por tool — mapeados para reconocimiento inmediato
const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Write: '✏️',  Edit: '✏️',  Bash: '🖥️',
  Glob: '🔍', Grep: '🔎',  WebSearch: '🌐', WebFetch: '🌐',
  Agent: '🤖', Skill: '⚡', TodoWrite: '📝', TodoRead: '📝',
  Task: '📋',  default: '🔧'
}

// Paleta de colores ANSI
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
}

export interface TraceEvent {
  type: string          // 'PreToolUse' | 'Done' | 'Stop' | 'SessionStart'
  tool_name?: string
  tool_input?: string   // JSON serializado
  ts: number
  duration_ms?: number
  session_id?: string
  cwd?: string
}

export interface RenderState {
  sessionId: string
  cwd: string
  startedAt: number
  events: TraceEvent[]
}

// Convierte timestamp relativo a formato "MM:SSS"
function relTs(base: number, ts: number): string {
  const diff = ts - base
  const s    = Math.floor(diff / 1000)
  const ms   = diff % 1000
  return `${String(s).padStart(2, '0')}:${String(ms).padStart(3, '0')}`
}

function fmt(ms?: number): string {
  if (!ms) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function trunc(s: string, n = 50): string {
  return s.length > n ? s.slice(0, n - 3) + '...' : s
}

// Extrae el argumento más legible de cada tool
function detail(toolName?: string, rawInput?: string): string {
  if (!toolName || !rawInput) return ''
  try {
    const inp = JSON.parse(rawInput)
    if (['Read','Write','Edit'].includes(toolName))  return trunc(inp.file_path || inp.path || '')
    if (toolName === 'Bash')                          return trunc(inp.command || '')
    if (['Glob','Grep'].includes(toolName))           return trunc(inp.pattern || inp.query || '')
    if (['WebSearch','WebFetch'].includes(toolName))  return trunc(inp.query || inp.url || '')
    if (toolName === 'Agent')                         return trunc((inp.prompt || '').slice(0, 40))
  } catch {}
  return ''
}

export function renderTrace(state: RenderState): string {
  const { sessionId, cwd, startedAt, events } = state
  const lines: string[] = []

  // ── Header ────────────────────────────────────────────────────────
  lines.push('')
  lines.push(
    `${C.bold}● claudetrace${C.reset}  ` +
    `${C.dim}session:${C.reset} ${C.cyan}${sessionId.slice(0, 8)}${C.reset}  ` +
    `${C.dim}dir:${C.reset} ${C.blue}${cwd}${C.reset}`
  )
  lines.push(C.dim + '─'.repeat(72) + C.reset)

  // ── Eventos ───────────────────────────────────────────────────────
  for (const ev of events) {
    const ts  = `${C.gray}[${relTs(startedAt, ev.ts)}]${C.reset}`
    const det = detail(ev.tool_name, ev.tool_input)
    const ico = TOOL_ICONS[ev.tool_name || ''] || ''

    if (ev.type === 'SessionStart') {
      lines.push(`  ${ts} 🔌 ${C.dim}Sesión iniciada${C.reset}`)

    } else if (ev.type === 'PreToolUse') {
      // Tool en curso — todavía no llegó el PostToolUse
      lines.push(
        `  ${ts} ${ico} ${C.yellow}${ev.tool_name}${C.reset}` +
        (det ? `  ${C.dim}${det}${C.reset}` : '') +
        `  ${C.dim}⟳ ejecutando...${C.reset}`
      )

    } else if (ev.type === 'Done') {
      // PreToolUse enriquecido con el resultado del PostToolUse
      lines.push(
        `  ${ts} ${ico} ${C.green}${ev.tool_name}${C.reset}` +
        (det ? `  ${C.dim}${det}${C.reset}` : '') +
        (ev.duration_ms ? `  ${C.dim}(${fmt(ev.duration_ms)})${C.reset}` : '')
      )

    } else if (ev.type === 'Stop') {
      lines.push(`  ${ts} ✅ ${C.green}Respuesta generada${C.reset}`)
    }
  }

  // ── Footer ────────────────────────────────────────────────────────
  const toolsDone     = events.filter(e => e.type === 'Done').length
  const toolsPending  = events.filter(e => e.type === 'PreToolUse').length
  const lastTs        = events.at(-1)?.ts ?? startedAt
  const elapsed       = fmt(lastTs - startedAt)

  lines.push('')
  lines.push(C.dim + '─'.repeat(72) + C.reset)
  lines.push(
    ` ${C.dim}⏱${C.reset} ${elapsed}   ` +
    `${C.dim}✅${C.reset} ${toolsDone} tools   ` +
    (toolsPending ? `${C.yellow}⟳ ${toolsPending} en curso${C.reset}   ` : '') +
    `${C.dim}💰 Coste: pendiente (enriqueciendo desde JSONL)${C.reset}`
  )
  lines.push('')

  return lines.join('\n')
}

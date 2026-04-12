import { useEffect, useRef } from 'react'
import type { TraceEvent, CostInfo } from '../types'

interface Props {
  events:    TraceEvent[]
  startedAt: number
  cost?:     CostInfo
}

const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Write: '✏️', Edit: '✏️', Bash: '🖥️',
  Glob: '🔍', Grep: '🔎', WebSearch: '🌐', WebFetch: '🌐',
  Agent: '🤖', Skill: '⚡', TodoWrite: '📝', TodoRead: '📝',
  Task: '📋', default: '🔧',
}

interface Block {
  index: number
  tools: TraceEvent[]
  hasStop: boolean
  mode: string
}

function groupBlocks(events: TraceEvent[]): Block[] {
  const blocks: Block[] = []
  let current: Block = { index: 1, tools: [], hasStop: false, mode: 'directo' }

  for (const ev of events) {
    if (ev.type === 'SessionStart') continue
    if (ev.type === 'Stop') {
      current.hasStop = true
      current.mode = detectMode(current.tools)
      blocks.push(current)
      current = { index: blocks.length + 1, tools: [], hasStop: false, mode: 'directo' }
    } else {
      current.tools.push(ev)
    }
  }
  if (current.tools.length > 0) {
    current.mode = detectMode(current.tools)
    blocks.push(current)
  }
  return blocks
}

function detectMode(tools: TraceEvent[]): string {
  const hasAgent = tools.some(e => e.tool_name === 'Agent')
  const hasSkill = tools.some(e => e.tool_name === 'Skill')
  if (hasAgent && hasSkill) return 'agentes+skills'
  if (hasAgent) return 'agentes'
  if (hasSkill) return 'skills'
  return 'directo'
}

function modeStyle(mode: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    'directo':        { label: 'directo',         color: '#7d8590' },
    'agentes':        { label: '🤖 agentes',       color: '#d29922' },
    'skills':         { label: '⚡ skills',         color: '#58a6ff' },
    'agentes+skills': { label: '🤖⚡ agentes+skills', color: '#d29922' },
  }
  return map[mode] ?? map['directo']
}

function relTs(base: number, ts: number): string {
  const diff = ts - base
  const s = Math.floor(diff / 1000); const ms = diff % 1000
  return `${String(s).padStart(2, '0')}:${String(ms).padStart(3, '0')}`
}

function fmtMs(ms?: number): string {
  if (!ms) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function trunc(s: string, n = 36): string {
  return s.length > n ? s.slice(0, n - 3) + '…' : s
}

function detail(toolName?: string, rawInput?: string): string {
  if (!toolName || !rawInput) return ''
  try {
    const inp = JSON.parse(rawInput)
    if (['Read','Write','Edit'].includes(toolName)) return trunc(inp.file_path || inp.path || '')
    if (toolName === 'Bash')                        return trunc(inp.command || '')
    if (['Glob','Grep'].includes(toolName))         return trunc(inp.pattern || inp.query || '')
    if (['WebSearch','WebFetch'].includes(toolName))return trunc(inp.query || inp.url || '')
    if (toolName === 'Agent')                       return trunc((inp.prompt || '').slice(0, 40))
    if (toolName === 'Skill')                       return trunc(inp.skill || inp.name || '')
  } catch {}
  return ''
}

const S = {
  panel: {
    background: '#0d1117',
    borderRight: '1px solid #21262d',
    overflowY: 'auto' as const,
    padding: '12px 0',
  },
  blockHeader: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '4px 16px', marginTop: 8,
  },
  blockNum:  { color: '#7d8590', fontSize: 11 },
  modeBadge: (color: string): React.CSSProperties => ({
    color, fontSize: 10, fontWeight: 600,
    background: color + '18', borderRadius: 3, padding: '1px 5px',
    border: `1px solid ${color}33`,
  }),
  row: (done: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'flex-start', gap: 8,
    padding: '3px 16px 3px 28px',
    borderLeft: `2px solid ${done ? '#1f6feb' : '#d2992244'}`,
    marginLeft: 8,
    opacity: done ? 1 : 0.7,
  }),
  ts:    { color: '#7d8590', fontSize: 11, minWidth: 52, paddingTop: 1 } as React.CSSProperties,
  icon:  { fontSize: 13, minWidth: 18, textAlign: 'center' as const },
  name:  (done: boolean): React.CSSProperties => ({
    color: done ? '#3fb950' : '#d29922', fontWeight: 600, fontSize: 12,
  }),
  det:   { color: '#7d8590', fontSize: 11, marginLeft: 4 } as React.CSSProperties,
  dur:   { color: '#7d8590', fontSize: 11, marginLeft: 'auto' as const } as React.CSSProperties,
  loop:  { color: '#f85149', fontSize: 10, fontWeight: 700, marginLeft: 4 } as React.CSSProperties,
  footer: {
    padding: '2px 16px 2px 28px',
    color: '#7d8590', fontSize: 11,
    borderLeft: '2px solid #21262d', marginLeft: 8, marginBottom: 4,
  } as React.CSSProperties,
  waiting: {
    padding: '40px 16px', color: '#7d8590', textAlign: 'center' as const, fontSize: 12,
  },
}

export function TracePanel({ events, startedAt, cost }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  const blocks = groupBlocks(events)

  if (blocks.length === 0) {
    return (
      <div style={S.panel}>
        <div style={S.waiting}>
          Esperando eventos de Claude Code…<br />
          <span style={{ fontSize: 10 }}>Abre Claude Code y empieza a trabajar</span>
        </div>
      </div>
    )
  }

  return (
    <div style={S.panel}>
      {blocks.map(block => {
        const isLast      = block.index === blocks.length
        const inProgress  = !block.hasStop && isLast
        const { label, color } = modeStyle(block.mode)

        // Contar tools para badge de loop
        const toolCount = new Map<string, number>()
        for (const t of block.tools) {
          if (t.tool_name) toolCount.set(t.tool_name, (toolCount.get(t.tool_name) || 0) + 1)
        }

        return (
          <div key={block.index}>
            {/* Cabecera del bloque */}
            <div style={S.blockHeader}>
              <span style={S.blockNum}>
                {inProgress ? '⟳' : '✓'} Respuesta #{block.index}
              </span>
              <span style={S.modeBadge(color)}>{label}</span>
            </div>

            {/* Tool calls */}
            {block.tools.map((ev, i) => {
              const done      = ev.type === 'Done'
              const ico       = TOOL_ICONS[ev.tool_name || ''] || TOOL_ICONS.default
              const det       = detail(ev.tool_name, ev.tool_input)
              const isLooping = (toolCount.get(ev.tool_name || '') || 0) >= 3

              return (
                <div key={i} style={S.row(done)}>
                  <span style={S.ts}>[{relTs(startedAt, ev.ts)}]</span>
                  <span style={S.icon}>{ico}</span>
                  <span style={S.name(done)}>{ev.tool_name || ev.type}</span>
                  {det && <span style={S.det}>{det}</span>}
                  {isLooping && <span style={S.loop}>⚠ loop</span>}
                  {done && ev.duration_ms && (
                    <span style={S.dur}>{fmtMs(ev.duration_ms)}</span>
                  )}
                  {!done && <span style={S.dur}>⟳</span>}
                </div>
              )
            })}

            {/* Footer del bloque */}
            {block.hasStop && (
              <div style={S.footer}>
                └─ ✅ {block.tools.filter(e => e.type === 'Done').length} tools completados
              </div>
            )}
          </div>
        )
      })}

      {/* Loop alerts */}
      {cost?.loops && cost.loops.length > 0 && (
        <div style={{ padding: '8px 16px' }}>
          {cost.loops.map((l, i) => (
            <div key={i} style={{ color: '#f85149', fontSize: 11, fontWeight: 600 }}>
              ⚠ Loop detectado: {l.toolName} × {l.count} en 60s
            </div>
          ))}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

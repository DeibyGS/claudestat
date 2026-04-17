import { useEffect, useRef, useState, useCallback } from 'react'
import { BarChart, Bar, ResponsiveContainer, Cell, Tooltip as RechartsTip } from 'recharts'
import {
  FileText, FilePlus, Pencil, Terminal, FolderSearch, Search,
  Globe, Bot, Zap, ListTodo, ClipboardList, Wrench,
  Loader2, CheckCircle2, TriangleAlert,
  ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight,
  X, Filter, ChevronsUpDown, ChevronsDownUp,
  Activity, Timer, BrainCircuit, Flame, Info, CircleX,
  type LucideIcon,
} from 'lucide-react'
import type { TraceEvent, CostInfo, BlockCost, MetaStats, MetaAlert, QuotaData, SessionState, DayStats } from '../types'

interface HiddenCostStats {
  loop_waste_usd: number
  total_cost_usd: number
  loop_sessions:  number
  total_loops:    number
  total_sessions: number
}

interface Props {
  events:        TraceEvent[]
  startedAt:     number
  cost?:         CostInfo
  blockCosts?:   BlockCost[]
  meta?:         MetaStats
  quota?:        QuotaData
  sessionState?: SessionState
  weeklyData:    DayStats[]
  hiddenCost?:   HiddenCostStats
}

// ─── Icon + Color maps ────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, LucideIcon> = {
  Read:      FileText,
  Write:     FilePlus,
  Edit:      Pencil,
  Bash:      Terminal,
  Glob:      FolderSearch,
  Grep:      Search,
  WebSearch: Globe,
  WebFetch:  Globe,
  Agent:     Bot,
  Skill:     Zap,
  TodoWrite: ListTodo,
  TodoRead:  ListTodo,
  Task:      ClipboardList,
  default:   Wrench,
}

const TOOL_COLORS: Record<string, string> = {
  Read:      '#58a6ff',
  Write:     '#3fb950',
  Edit:      '#3fb950',
  Bash:      '#d29922',
  Glob:      '#79c0ff',
  Grep:      '#79c0ff',
  WebSearch: '#56d364',
  WebFetch:  '#56d364',
  Agent:     '#bc8cff',
  Skill:     '#58a6ff',
  TodoWrite: '#8b949e',
  TodoRead:  '#8b949e',
  Task:      '#8b949e',
  default:   '#6e7681',
}

// ─── Guardrails ───────────────────────────────────────────────────────────────

const DANGEROUS_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /rm\s+-[rf]*r[rf]*/i,              label: 'rm -rf' },
  { re: /DROP\s+(TABLE|DATABASE|SCHEMA)/i, label: 'DROP' },
  { re: /git\s+push\s+.*--force/i,         label: 'force push' },
  { re: /git\s+reset\s+--hard/i,           label: 'git reset --hard' },
  { re: /chmod\s+777/i,                    label: 'chmod 777' },
  { re: /mkfs/i,                           label: 'mkfs' },
  { re: /dd\s+if=/i,                       label: 'dd if=' },
  { re: /TRUNCATE\s+TABLE/i,               label: 'TRUNCATE' },
  { re: /:\(\)\s*\{.*\}\s*;/,             label: 'fork bomb' },
]

function checkDangerous(toolName?: string, rawInput?: string): string | null {
  if (toolName !== 'Bash' || !rawInput) return null
  try {
    const cmd: string = JSON.parse(rawInput).command || ''
    const match = DANGEROUS_PATTERNS.find(p => p.re.test(cmd))
    return match ? match.label : null
  } catch { return null }
}

// ─── Diff View ────────────────────────────────────────────────────────────────

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 11, borderRadius: 6, overflow: 'auto', border: '1px solid #30363d', maxHeight: 320 }}>
      {oldLines.map((line, i) => (
        <div key={`-${i}`} style={{ background: '#3d1c1c', padding: '1px 10px', display: 'flex', gap: 8, minHeight: 18 }}>
          <span style={{ color: '#f85149', userSelect: 'none', flexShrink: 0, fontWeight: 700 }}>-</span>
          <span style={{ color: '#ffa198', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</span>
        </div>
      ))}
      {newLines.map((line, i) => (
        <div key={`+${i}`} style={{ background: '#1a2d1a', padding: '1px 10px', display: 'flex', gap: 8, minHeight: 18 }}>
          <span style={{ color: '#3fb950', userSelect: 'none', flexShrink: 0, fontWeight: 700 }}>+</span>
          <span style={{ color: '#7ee787', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Tool categories ──────────────────────────────────────────────────────────

const CAT_COLORS = {
  read:  '#58a6ff',
  write: '#3fb950',
  bash:  '#d29922',
  agent: '#bc8cff',
  web:   '#56d364',
  other: '#484f58',
} as const
type Cat = keyof typeof CAT_COLORS

function categorize(toolName?: string): Cat {
  if (!toolName) return 'other'
  if (['Read', 'Glob', 'Grep', 'TodoRead'].includes(toolName))  return 'read'
  if (['Write', 'Edit', 'TodoWrite'].includes(toolName))        return 'write'
  if (toolName === 'Bash')                                       return 'bash'
  if (['Agent', 'Skill', 'Task'].includes(toolName))            return 'agent'
  if (['WebSearch', 'WebFetch'].includes(toolName))             return 'web'
  return 'other'
}

interface ToolStats {
  read: number; write: number; bash: number
  agent: number; web: number; other: number
  total: number
}

function calcStats(tools: TraceEvent[]): ToolStats {
  const s: ToolStats = { read: 0, write: 0, bash: 0, agent: 0, web: 0, other: 0, total: 0 }
  for (const t of tools) {
    if (!t.tool_name) continue
    s[categorize(t.tool_name)]++
    s.total++
  }
  return s
}

function getIntent(stats: ToolStats): { label: string; color: string } | null {
  if (stats.total === 0) return null
  const { read, write, bash, agent } = stats
  if (agent > 0 && agent / stats.total >= 0.3) return { label: 'Delegando',     color: '#bc8cff' }
  if (write === 0 && bash === 0 && read > 0)   return { label: 'Explorando',    color: '#58a6ff' }
  if (write / stats.total > 0.4)               return { label: 'Implementando', color: '#3fb950' }
  if (bash > 0 && read > 0)                    return { label: 'Debugging',     color: '#d29922' }
  if (write > 0 || bash > 0)                   return { label: 'Edición+Cmd',   color: '#8b949e' }
  return null
}

function summaryText(stats: ToolStats): string {
  const parts: string[] = []
  if (stats.read  > 0) parts.push(`${stats.read} read`)
  if (stats.write > 0) parts.push(`${stats.write} write`)
  if (stats.bash  > 0) parts.push(`${stats.bash} bash`)
  if (stats.agent > 0) parts.push(`${stats.agent} agent`)
  if (stats.web   > 0) parts.push(`${stats.web} web`)
  if (stats.other > 0) parts.push(`${stats.other} other`)
  return parts.join(' · ')
}

// ─── Filter ───────────────────────────────────────────────────────────────────

type FilterType = 'all' | 'read' | 'write' | 'bash' | 'agent' | 'web'
const FILTER_GROUPS: Record<FilterType, string[]> = {
  all:   [],
  read:  ['Read', 'Glob', 'Grep'],
  write: ['Write', 'Edit'],
  bash:  ['Bash'],
  agent: ['Agent', 'Skill'],
  web:   ['WebSearch', 'WebFetch'],
}
const FILTER_LABELS: { id: FilterType; label: string; icon: LucideIcon; color: string }[] = [
  { id: 'all',   label: 'Todo',  icon: Filter,   color: '#8b949e' },
  { id: 'read',  label: 'Read',  icon: FileText,  color: '#58a6ff' },
  { id: 'write', label: 'Write', icon: Pencil,    color: '#3fb950' },
  { id: 'bash',  label: 'Bash',  icon: Terminal,  color: '#d29922' },
  { id: 'agent', label: 'Agent', icon: Bot,       color: '#bc8cff' },
  { id: 'web',   label: 'Web',   icon: Globe,     color: '#56d364' },
]
function matchesFilter(toolName: string | undefined, filter: FilterType): boolean {
  if (filter === 'all' || !toolName) return true
  return FILTER_GROUPS[filter].includes(toolName)
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Block {
  index:   number
  tools:   TraceEvent[]
  hasStop: boolean
  endTs?:  number
}
interface Actor {
  label: string; color: string; type: 'claude' | 'agent' | 'skill'
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

function groupBlocks(events: TraceEvent[]): Block[] {
  const blocks: Block[] = []
  let current: Block = { index: 1, tools: [], hasStop: false }
  for (const ev of events) {
    if (ev.type === 'SessionStart') continue
    if (ev.type === 'Stop') {
      current.hasStop = true; current.endTs = ev.ts
      blocks.push(current)
      current = { index: blocks.length + 1, tools: [], hasStop: false }
    } else {
      current.tools.push(ev)
    }
  }
  if (current.tools.length > 0) blocks.push(current)
  return blocks
}

function extractActors(tools: TraceEvent[]): Actor[] {
  const agents: string[] = []
  const skills: string[] = []
  let hasDirect = false
  for (const t of tools) {
    if (t.tool_name === 'Agent' && t.tool_input) {
      try {
        const inp = JSON.parse(t.tool_input)
        const type = inp.subagent_type || 'agent'
        if (!agents.includes(type)) agents.push(type)
      } catch { if (!agents.includes('agent')) agents.push('agent') }
    } else if (t.tool_name === 'Skill' && t.tool_input) {
      try {
        const inp = JSON.parse(t.tool_input)
        const name = inp.skill || inp.name || 'skill'
        if (!skills.includes(name)) skills.push(name)
      } catch { if (!skills.includes('skill')) skills.push('skill') }
    } else if (t.tool_name) {
      hasDirect = true
    }
  }
  if (agents.length === 0 && skills.length === 0)
    return [{ label: 'Claude', color: '#7d8590', type: 'claude' }]
  const result: Actor[] = []
  if (hasDirect) result.push({ label: 'Claude', color: '#7d8590', type: 'claude' })
  for (const a of agents) result.push({ label: a, color: '#bc8cff', type: 'agent' })
  for (const s of skills) result.push({ label: `/${s}`, color: '#58a6ff', type: 'skill' })
  return result
}

function blockDuration(block: Block): string {
  if (!block.hasStop || !block.endTs || block.tools.length === 0) return ''
  const ms = block.endTs - block.tools[0].ts
  if (ms < 1000)  return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function fmtUsd(usd: number): string {
  if (usd < 0.00005) return '<$0.0001'
  if (usd < 0.01)    return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(3)}`
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

function estimateCacheSavings(cacheRead: number, model?: string): number {
  if (cacheRead === 0) return 0
  if (model?.includes('opus'))  return cacheRead * 13.50 / 1_000_000
  if (model?.includes('haiku')) return cacheRead *  0.72 / 1_000_000
  return cacheRead * 2.70 / 1_000_000
}

function relTs(base: number, ts: number): string {
  const diff = ts - base
  const s = Math.floor(diff / 1000); const ms = diff % 1000
  return `${String(s).padStart(2, '0')}:${String(ms).padStart(3, '0')}`
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tokens`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K tokens`
  return `${n} tokens`
}

function fmtMs(ms?: number): string {
  if (!ms) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function trunc(s: string, n = 44): string {
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
    if (toolName === 'Agent') {
      // Intentar extraer nombre del agente del pipeline (ej: agents/scrum-master.md)
      const prompt = (inp.prompt || inp.description || '') as string
      const roleMatch = prompt.match(/agents\/([^/.]+)\.md/)
      if (roleMatch) return roleMatch[1]  // ej: "scrum-master"
      return trunc(prompt.slice(0, 60))
    }
    if (toolName === 'Skill')                       return trunc(inp.skill || inp.name || '')
  } catch {}
  return ''
}

function fmtJson(raw?: string): string {
  if (!raw) return ''
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function ActorBadge({ actor }: { actor: Actor }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
      color: actor.color, background: actor.color + '15', border: `1px solid ${actor.color}30`,
    }}>
      {actor.type === 'agent' && <Bot size={9} />}
      {actor.type === 'skill' && <Zap size={9} />}
      {actor.label}
    </span>
  )
}

function IntentBadge({ intent }: { intent: { label: string; color: string } }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600,
      color: intent.color, background: intent.color + '15',
      border: `1px solid ${intent.color}30`,
      borderRadius: 4, padding: '1px 6px', flexShrink: 0,
    }}>
      {intent.label}
    </span>
  )
}

function ToolDistBar({ stats }: { stats: ToolStats }) {
  if (stats.total === 0) return null
  const cats: [Cat, number][] = [
    ['read', stats.read], ['write', stats.write], ['bash', stats.bash],
    ['agent', stats.agent], ['web', stats.web], ['other', stats.other],
  ]
  return (
    <div style={{
      display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden',
      width: 48, flexShrink: 0, background: '#1a1f26',
    }}>
      {cats.filter(([, n]) => n > 0).map(([cat, n]) => (
        <div key={cat} title={`${cat}: ${n}`}
          style={{ width: `${(n / stats.total) * 100}%`, background: CAT_COLORS[cat] }} />
      ))}
    </div>
  )
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({ ev, onClose }: { ev: TraceEvent; onClose: () => void }) {
  const Icon  = TOOL_ICONS[ev.tool_name || ''] || TOOL_ICONS.default
  const color = TOOL_COLORS[ev.tool_name || ''] || TOOL_COLORS.default
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: '#00000088',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#161b22', border: `1px solid ${color}40`,
        borderLeft: `3px solid ${color}`, borderRadius: 10,
        width: '100%', maxWidth: 700, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: `0 8px 32px #00000099, 0 0 0 1px ${color}20`,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderBottom: '1px solid #30363d', flexShrink: 0,
        }}>
          <span style={{ display: 'flex', alignItems: 'center', color }}><Icon size={16} /></span>
          <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 14 }}>
            {ev.tool_name || ev.type}
            {ev.tool_name === 'Agent' && ev.tool_input && (() => {
              try {
                const inp = JSON.parse(ev.tool_input)
                const t   = inp.subagent_type || inp.description
                return t
                  ? <span style={{ color: '#bc8cff', fontSize: 12, fontWeight: 500, marginLeft: 6 }}>› {t}</span>
                  : null
              } catch { return null }
            })()}
          </span>
          {ev.duration_ms && (
            <span style={{ fontSize: 11, color: '#6e7681', background: '#21262d', borderRadius: 4, padding: '1px 6px' }}>
              {fmtMs(ev.duration_ms)}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#6e7681', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4,
          }}><X size={16} /></button>
        </div>
        <div style={{ overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Guardrail alert */}
          {(() => {
            const danger = checkDangerous(ev.tool_name, ev.tool_input)
            if (!danger) return null
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#3d1717', border: '1px solid #f8514960', borderRadius: 6, padding: '8px 12px' }}>
                <TriangleAlert size={14} color="#f85149" />
                <div>
                  <span style={{ color: '#f85149', fontWeight: 700, fontSize: 12 }}>Comando peligroso detectado — {danger}</span>
                  <span style={{ color: '#8b949e', fontSize: 11, marginLeft: 8 }}>Verifica que esta operación sea intencional</span>
                </div>
              </div>
            )
          })()}

          {/* Input — diff para Edit, raw para el resto */}
          {ev.tool_input && (() => {
            if (ev.tool_name === 'Edit') {
              try {
                const inp = JSON.parse(ev.tool_input)
                if (inp.old_string !== undefined && inp.new_string !== undefined) {
                  return (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#58a6ff', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                        Diff — {inp.file_path ? <span style={{ color: '#79c0ff', fontWeight: 400, textTransform: 'none' }}>{inp.file_path.split('/').pop()}</span> : null}
                      </div>
                      <DiffView oldText={inp.old_string} newText={inp.new_string} />
                    </div>
                  )
                }
              } catch {}
            }
            const formatted = fmtJson(ev.tool_input)
            if (!formatted) return null
            return (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#58a6ff', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Input</div>
                <pre style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '10px 12px', fontSize: 11, color: '#c9d1d9', margin: 0, overflow: 'auto', maxHeight: 220, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {formatted}
                </pre>
              </div>
            )
          })()}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#3fb950', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
              Output
            </div>
            {ev.tool_output ? (
              <pre style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '10px 12px', fontSize: 11, color: '#c9d1d9', margin: 0, overflow: 'auto', maxHeight: 260, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {ev.tool_output}
              </pre>
            ) : (
              <div style={{ background: '#0d1117', border: '1px solid #21262d30', borderRadius: 6, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <CircleX size={13} color="#484f58" />
                <div>
                  <div style={{ color: '#484f58', fontSize: 11, fontWeight: 500 }}>Output no almacenado</div>
                  <div style={{ color: '#3d444d', fontSize: 10, marginTop: 2 }}>Los outputs solo se capturan en sesiones activas. Los eventos históricos no los incluyen.</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sidebar KPI components ───────────────────────────────────────────────────

const STATE_META: Record<SessionState, { label: string; color: string; pulse: boolean }> = {
  working:           { label: 'working', color: '#3fb950', pulse: true  },
  waiting_for_input: { label: 'waiting', color: '#58a6ff', pulse: false },
  idle:              { label: 'idle',    color: '#7d8590', pulse: false },
}

const PLAN_LABEL: Record<string, string> = {
  free: 'Free', pro: 'Pro', max5: 'Max 5×', max20: 'Max 20×',
}

const ALERT_ICON: Record<string, LucideIcon> = {
  info: Info, warning: TriangleAlert, critical: CircleX,
}

function fmtResetMs(ms: number): string {
  if (ms <= 0) return 'ahora'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function ModelBarMini({ label, color, hours, limit }: { label: string; color: string; hours: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round(hours / limit * 100)) : null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ color, fontSize: 9, fontWeight: 700, width: 40, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
        {pct !== null && (
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2,
            background: pct > 85 ? '#f85149' : pct > 65 ? '#d29922' : color }} />
        )}
      </div>
      <span style={{ color: '#6e7681', fontSize: 9, width: 22, textAlign: 'right', flexShrink: 0 }}>
        {hours > 0 ? `${hours}h` : '—'}
      </span>
    </div>
  )
}

function SidebarKPI({ cost, quota, sessionState = 'idle', meta }: {
  cost?:         CostInfo
  quota?:        QuotaData
  sessionState?: SessionState
  meta?:         MetaStats
}) {
  const sm = STATE_META[sessionState]

  const COMPACT_THRESHOLD = 0.85
  const compactWindow = cost?.context_window ? Math.round(cost.context_window * COMPACT_THRESHOLD) : null
  const contextPct = cost?.context_used && compactWindow
    ? Math.min(100, Math.round(cost.context_used / compactWindow * 100)) : null
  const remaining  = contextPct !== null ? 100 - contextPct : null
  const ctxColor   = remaining === null ? '#484f58'
    : remaining < 15 ? '#f85149' : remaining < 35 ? '#d29922' : '#3fb950'

  const alerts: MetaAlert[] = []
  if (meta?.alerts) alerts.push(...meta.alerts)
  if (contextPct !== null && contextPct > 85)
    alerts.push({ level: 'critical', message: `Auto-compact muy pronto — ${remaining}% libre`, metric: 'context' })
  else if (contextPct !== null && contextPct > 65)
    alerts.push({ level: 'warning', message: `Contexto al ${contextPct}%`, metric: 'context' })

  return (
    <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid #21262d', flexShrink: 0,
      display: 'flex', flexDirection: 'column', gap: 7 }}>

      {/* Estado + Cuota badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {sm.pulse && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: sm.color,
              display: 'inline-block', boxShadow: `0 0 4px ${sm.color}`,
              animation: 'pulse 1.2s ease-in-out infinite' }} />
          )}
          <span style={{ color: sm.color, fontSize: 11, fontWeight: 700 }}>{sm.label}</span>
        </div>
        {quota && (
          <span style={{ fontSize: 10, fontWeight: 700, flexShrink: 0,
            color: quota.cyclePct > 85 ? '#f85149' : quota.cyclePct > 65 ? '#d29922' : '#7d8590',
            background: '#161b22', borderRadius: 3, padding: '1px 6px', border: '1px solid #21262d' }}
            title={`Cuota 5h est. — ${PLAN_LABEL[quota.detectedPlan] ?? quota.detectedPlan}. Reset en ${fmtResetMs(quota.cycleResetAt ? quota.cycleResetAt - Date.now() : quota.cycleResetMs)}`}
          >
            <Timer size={8} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />
            {quota.cyclePrompts}/{quota.cycleLimit} · {quota.cyclePct}%
          </span>
        )}
      </div>

      {/* Context bar */}
      <div title={`% libre calculado sobre el umbral de auto-compact (~85% de la ventana total).\nSe alinea con "X% until auto-compact" del terminal de Claude Code.\nVentana total: ${fmtTok(cost?.context_window ?? 200_000)} · Umbral: ${fmtTok(compactWindow ?? 170_000)}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <BrainCircuit size={9} color="#484f58" />
            <span style={{ fontSize: 9, color: '#484f58', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Contexto</span>
          </div>
          <span style={{ fontSize: 10, color: ctxColor, fontWeight: 600 }}>
            {remaining !== null ? `~${remaining}% libre` : '—'}
          </span>
        </div>
        <div style={{ height: 4, background: '#161b22', borderRadius: 2, overflow: 'hidden' }}>
          {contextPct !== null && (
            <div style={{
              width: `${contextPct}%`, height: '100%', background: ctxColor,
              borderRadius: 2, transition: 'width 0.5s',
              animation: remaining !== null && remaining < 20 ? 'ctxPulse 1.2s ease-in-out infinite' : undefined,
            }} />
          )}
        </div>
        {cost?.context_used && (
          <div style={{ fontSize: 9, color: '#484f58', marginTop: 2 }}>
            {fmtTok(cost.context_used)} / {fmtTok(compactWindow ?? 170_000)} · <span style={{ color: '#7d859066' }}>umbral</span>
          </div>
        )}
      </div>

      {/* Model bars */}
      {quota && (quota.weeklyHoursSonnet > 0 || quota.weeklyHoursOpus > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 9, color: '#484f58', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Modelos · semana</span>
          <ModelBarMini label="Sonnet" color="#58a6ff" hours={quota.weeklyHoursSonnet} limit={quota.weeklyLimitSonnet} />
          {quota.weeklyLimitOpus > 0 && (
            <ModelBarMini label="Opus" color="#d29922" hours={quota.weeklyHoursOpus} limit={quota.weeklyLimitOpus} />
          )}
          {(quota.weeklyHoursHaiku ?? 0) > 0 && (
            <ModelBarMini label="Haiku" color="#3fb950" hours={quota.weeklyHoursHaiku!} limit={0} />
          )}
        </div>
      )}

      {/* Burn rate */}
      {quota && quota.burnRateTokensPerMin > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Flame size={9} color="#d29922" />
          <span style={{ fontSize: 10, color: '#d29922', fontWeight: 600 }}>
            {quota.burnRateTokensPerMin.toLocaleString()} tok/min
          </span>
          <span style={{ fontSize: 9, color: '#484f58' }}>· últimos 30m</span>
        </div>
      )}

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {alerts.slice(0, 2).map((a, i) => {
            const c = ({ info: '#58a6ff', warning: '#d29922', critical: '#f85149' } as const)[a.level]
            const AlertIcon = ALERT_ICON[a.level] ?? Info
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: c,
                background: c + '15', border: `1px solid ${c}30`, borderRadius: 3, padding: '2px 6px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <AlertIcon size={9} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.message}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Contador animado de costo — interpola del valor anterior al nuevo en 600ms */
function AnimatedCost({ usd }: { usd: number }) {
  const [displayed, setDisplayed] = useState(usd)
  const prev = useRef(usd)
  const raf  = useRef<number>(0)

  useEffect(() => {
    const from  = prev.current
    const to    = usd
    if (Math.abs(to - from) < 0.00005) { setDisplayed(to); return }
    const start = performance.now()
    const dur   = 600
    const tick  = (now: number) => {
      const t = Math.min((now - start) / dur, 1)
      const ease = 1 - Math.pow(1 - t, 3)  // ease-out-cubic
      setDisplayed(from + (to - from) * ease)
      if (t < 1) raf.current = requestAnimationFrame(tick)
      else prev.current = to
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [usd])

  return <>{fmtUsd(displayed)}</>
}

function SidebarStats({ cost, weeklyData, events, hiddenCost }: {
  cost?:       CostInfo
  weeklyData:  DayStats[]
  events:      TraceEvent[]
  hiddenCost?: HiddenCostStats
}) {
  const score = cost
    ? (cost.efficiency_score === 0 && cost.cost_usd < 0.001 ? 100 : cost.efficiency_score)
    : null
  const scoreColor = score === null ? '#484f58'
    : score >= 90 ? '#3fb950' : score >= 70 ? '#d29922' : '#f85149'
  const savings = cost ? estimateCacheSavings(cost.cache_read, cost.model) : 0
  const totalWeekly = weeklyData.reduce((s, d) => s + d.tokens, 0)

  if (!cost && weeklyData.length === 0) return null

  return (
    <div style={{ borderTop: '1px solid #21262d', flexShrink: 0, padding: '8px 12px',
      display: 'flex', flexDirection: 'column', gap: 6, background: '#090d12' }}>

      {cost && cost.cost_usd > 0 && (
        <>
          {/* Cost + tokens */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ background: '#3fb95022', color: '#3fb950', border: '1px solid #3fb95044',
              borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
              <AnimatedCost usd={cost.cost_usd} />
            </span>
            <span style={{ fontSize: 10, color: '#6e7681' }}>{fmtTok(cost.input_tokens)} in</span>
            <span style={{ color: '#30363d', fontSize: 10 }}>·</span>
            <span style={{ fontSize: 10, color: '#6e7681' }}>{fmtTok(cost.output_tokens)} out</span>
            {cost.cache_read > 0 && (
              <>
                <span style={{ color: '#30363d', fontSize: 10 }}>·</span>
                <span style={{ fontSize: 10, color: '#3fb95099' }}>{fmtTok(cost.cache_read)} cache</span>
              </>
            )}
          </div>
          {savings >= 0.001 && (
            <div style={{ fontSize: 9, color: '#3fb95088' }}>~{fmtUsd(savings)} ahorrado por caché</div>
          )}
          {/* Efficiency */}
          {score !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <Activity size={9} color="#484f58" />
                <span style={{ fontSize: 9, color: '#484f58', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>eficiencia</span>
              </div>
              <div style={{ flex: 1, height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${score}%`, height: '100%', background: scoreColor,
                  borderRadius: 2, transition: 'width 0.5s', boxShadow: `0 0 3px ${scoreColor}88` }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor }}>{score}</span>
            </div>
          )}
        </>
      )}

      {/* Weekly chart */}
      {weeklyData.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 28 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
                <RechartsTip
                  contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 4, fontSize: 10 }}
                  formatter={(v: number) => [fmtTok(v), 'tokens']}
                />
                <Bar dataKey="tokens" radius={[2, 2, 0, 0]}>
                  {weeklyData.map((_, i) => (
                    <Cell key={i} fill={i === weeklyData.length - 1 ? '#3fb950' : '#1f6feb'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 11 }}>{fmtTok(totalWeekly)}</div>
            <div style={{ color: '#484f58', fontSize: 9 }}>7 días</div>
          </div>
        </div>
      )}

      {/* Coste oculto semanal */}
      {hiddenCost && hiddenCost.total_loops > 0 && (
        <div style={{
          borderTop: '1px solid #21262d', paddingTop: 6, marginTop: 2,
          display: 'flex', flexDirection: 'column', gap: 3,
        }}
          title={`Estimación: ${hiddenCost.loop_sessions} sesiones con loops esta semana.\n${hiddenCost.total_loops} loops detectados en ${hiddenCost.total_sessions} sesiones.`}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Flame size={9} color="#d29922" />
            <span style={{ fontSize: 9, color: '#7d8590', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>coste oculto 7d</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              background: '#3d2600', color: '#d29922', border: '1px solid #d2992244',
              borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700,
            }}>
              ~{fmtUsd(hiddenCost.loop_waste_usd)}
            </span>
            <span style={{ fontSize: 9, color: '#484f58' }}>perdido en loops</span>
          </div>
          <div style={{ fontSize: 9, color: '#3d444d' }}>
            {hiddenCost.total_loops} loop{hiddenCost.total_loops > 1 ? 's' : ''} · {hiddenCost.loop_sessions}/{hiddenCost.total_sessions} sesiones
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Cost Timeline ────────────────────────────────────────────────────────────

function CostTimeline({
  blocks, blockCosts, selected, onSelect,
}: {
  blocks:     Block[]
  blockCosts: BlockCost[]
  selected:   number
  onSelect:   (blockIndex: number) => void
}) {
  const costs = blocks.map(b => {
    const bc = blockCosts[b.index - 1]
    return bc ? bc.inputUsd + bc.outputUsd : 0
  })
  const maxCost = Math.max(...costs, 0.000001)
  const total   = costs.reduce((a, c) => a + c, 0)
  const hasData = costs.some(c => c > 0)
  if (!hasData) return null

  const BAR_MAX = 40

  return (
    <div style={{ borderBottom: '1px solid #21262d', background: '#090d12', padding: '8px 16px 0', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#484f58', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
        <span>Costo por bloque</span>
        <span style={{ color: '#6e7681' }}>total {fmtUsd(total)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: BAR_MAX }}>
        {blocks.map((block, i) => {
          const cost    = costs[i]
          const inProg  = !block.hasStop && i === blocks.length - 1
          const isSel   = block.index === selected
          const isMax   = cost === maxCost && cost > 0
          const barH    = cost > 0 ? Math.max(4, (cost / maxCost) * BAR_MAX) : 4
          const color   = inProg ? '#d29922' : isSel ? '#58a6ff' : '#1f6feb'
          return (
            <div
              key={block.index}
              onClick={() => onSelect(block.index)}
              title={`#${block.index}${cost > 0 ? ` — ${fmtUsd(cost)}` : ' — sin datos'}`}
              style={{
                flex: 1, maxWidth: 28, minWidth: 5,
                height: barH, alignSelf: 'flex-end',
                background: cost > 0 ? color : '#1a1f26',
                borderRadius: '2px 2px 0 0',
                cursor: 'pointer',
                opacity: isSel ? 1 : isMax ? 0.85 : 0.45,
                transition: 'opacity 0.15s, background 0.15s',
                outline: isSel ? `2px solid ${color}` : 'none',
                outlineOffset: 1,
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = isSel ? '1' : isMax ? '0.85' : '0.45')}
            />
          )
        })}
      </div>
      {blocks.length <= 16 && (
        <div style={{ display: 'flex', gap: 3, marginTop: 2, marginBottom: 1 }}>
          {blocks.map(block => (
            <div key={block.index} style={{ flex: 1, maxWidth: 28, minWidth: 5, textAlign: 'center', fontSize: 8, color: block.index === selected ? '#6e7681' : '#2d3138' }}>
              {block.index}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Block List Item ──────────────────────────────────────────────────────────

function BlockListItem({
  block, blockCost, isLast, isSelected, onClick,
}: {
  block:      Block
  blockCost?: BlockCost
  isLast:     boolean
  isSelected: boolean
  onClick:    () => void
}) {
  const inProgress = !block.hasStop && isLast
  const actors     = extractActors(block.tools)
  const stats      = calcStats(block.tools)
  const intent     = getIntent(stats)
  const dur        = blockDuration(block)
  const totalCost  = blockCost ? blockCost.inputUsd + blockCost.outputUsd : 0
  const borderColor = isSelected ? '#58a6ff' : inProgress ? '#d29922' : '#30363d'

  return (
    <div
      onClick={onClick}
      style={{
        margin: '4px 8px',
        borderRadius: 7,
        border: `1px solid ${isSelected ? '#58a6ff40' : inProgress ? '#d2992240' : '#1e2329'}`,
        borderLeft: `3px solid ${borderColor}`,
        background: isSelected ? '#161d2d' : inProgress ? '#1c1a14' : '#111519',
        padding: '8px 10px',
        cursor: 'pointer',
        transition: 'background 0.12s, border-color 0.12s',
        animation: inProgress ? 'borderPulse 2s ease-in-out infinite' : undefined,
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#161b22' }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = inProgress ? '#1c1a14' : '#111519' }}
    >
      {/* Row 1: index + actors + cost + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        <span style={{ color: '#484f58', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>#{block.index}</span>
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', minWidth: 0, flex: 1, overflow: 'hidden' }}>
          {actors.slice(0, 1).map((a, i) => <ActorBadge key={i} actor={a} />)}
          {actors.length > 1 && <span style={{ fontSize: 9, color: '#6e7681' }}>+{actors.length - 1}</span>}
        </div>
        {totalCost > 0 && (
          <span style={{ color: isSelected ? '#79c0ff' : '#6e7681', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
            {fmtUsd(totalCost)}
          </span>
        )}
        {inProgress
          ? <Loader2 size={11} style={{ color: '#d29922', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          : block.hasStop && <CheckCircle2 size={11} style={{ color: '#3fb95066', flexShrink: 0 }} />
        }
      </div>
      {/* Row 2: dist bar + intent + duration */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {block.tools.length === 0
          ? <span style={{ color: '#484f58', fontSize: 10, fontStyle: 'italic' }}>respuesta de texto</span>
          : <>
              <ToolDistBar stats={stats} />
              {intent && <IntentBadge intent={intent} />}
            </>
        }
        <div style={{ flex: 1 }} />
        {dur && <span style={{ color: '#484f58', fontSize: 10, flexShrink: 0 }}>{dur}</span>}
      </div>
    </div>
  )
}

// ─── Tool Row ─────────────────────────────────────────────────────────────────

function ToolRow({
  ev, startedAt, isLooping, onClick,
}: {
  ev:        TraceEvent
  startedAt: number
  isLooping: boolean
  onClick:   () => void
}) {
  const done  = ev.type === 'Done'
  const Icon  = TOOL_ICONS[ev.tool_name || ''] || TOOL_ICONS.default
  const color = done ? (TOOL_COLORS[ev.tool_name || ''] || TOOL_COLORS.default) : '#6e7681'
  const det   = detail(ev.tool_name, ev.tool_input)

  return (
    <div
      onClick={done ? onClick : undefined}
      title={done ? 'Click para ver input/output' : 'En progreso…'}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 12px 4px 16px',
        borderLeft: `2px solid ${done ? color + '50' : '#21262d'}`,
        marginLeft: 8,
        opacity: done ? 1 : 0.6,
        cursor: done ? 'pointer' : 'default',
        borderRadius: '0 4px 4px 0',
      }}
      onMouseEnter={e => done && (e.currentTarget.style.background = '#161b22')}
      onMouseLeave={e => done && (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ color: '#484f58', fontSize: 10, minWidth: 48, fontFamily: 'monospace' }}>
        {relTs(startedAt, ev.ts)}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', color, flexShrink: 0 }}><Icon size={12} /></span>
      <span style={{ color: done ? '#c9d1d9' : '#8b949e', fontWeight: 600, fontSize: 11, flexShrink: 0 }}>
        {ev.tool_name || ev.type}
      </span>
      {det && (
        <span style={{ color: '#484f58', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {det}
        </span>
      )}
      {!det && <span style={{ flex: 1 }} />}
      {isLooping && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#f85149', fontSize: 10, fontWeight: 700, background: '#f8514918', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
          <TriangleAlert size={9} /> loop
        </span>
      )}
      {checkDangerous(ev.tool_name, ev.tool_input) && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#ff7b72', fontSize: 10, fontWeight: 700, background: '#f8514920', border: '1px solid #f8514940', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
          <TriangleAlert size={9} /> peligroso
        </span>
      )}
      {/* Badge de modelo para llamadas Agent */}
      {done && ev.tool_name === 'Agent' && (() => {
        try {
          const inp = JSON.parse(ev.tool_input || '{}')
          const model = inp.model as string | undefined
          if (model) {
            const s = fmtModelBlock(model)
            return (
              <span style={{ color: s.color, fontSize: 9, fontWeight: 700, background: s.color + '18', border: `1px solid ${s.color}30`, borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
                {s.name}
              </span>
            )
          }
        } catch {}
        return null
      })()}
      {!done
        ? <Loader2 size={10} style={{ color: '#6e7681', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
        : <CheckCircle2 size={10} style={{ color: color + 'aa', flexShrink: 0 }} />
      }
    </div>
  )
}

// ─── Section header helper ────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: '#484f58', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
      {children}
    </div>
  )
}

function fmtModelBlock(model: string): { name: string; color: string } {
  if (model.includes('opus'))   return { name: 'Opus 4.6',   color: '#d29922' }
  if (model.includes('haiku'))  return { name: 'Haiku 4.5',  color: '#3fb950' }
  if (model.includes('sonnet')) return { name: 'Sonnet 4.6', color: '#58a6ff' }
  return { name: model.replace('claude-', '').split('-').slice(0, 2).join(' '), color: '#8b949e' }
}


// ─── Block Detail Panel ───────────────────────────────────────────────────────

function BlockDetailPanel({
  block, startedAt, blockCost, sessionModel,
}: {
  block:         Block
  startedAt:     number
  blockCost?:    BlockCost
  sessionModel?: string
}) {
  const [filter,      setFilter]      = useState<FilterType>('all')
  const [selected,    setSelected]    = useState<TraceEvent | null>(null)
  const [logOpen,     setLogOpen]     = useState(true)
  const [durOpen,     setDurOpen]     = useState(false)
  const [filesOpen,   setFilesOpen]   = useState(true)
  const [bashOpen,    setBashOpen]    = useState(true)

  const actors    = extractActors(block.tools)
  const stats     = calcStats(block.tools)
  const intent    = getIntent(stats)
  const dur       = blockDuration(block)
  const totalCost = blockCost ? blockCost.inputUsd + blockCost.outputUsd : 0
  const inProg    = !block.hasStop

  // Duration timeline — only Done events with timing
  const timedTools = block.tools.filter(t => t.type === 'Done' && (t.duration_ms ?? 0) > 0)
  const maxDur     = Math.max(...timedTools.map(t => t.duration_ms ?? 0), 1)

  // Files touched (Read/Write/Edit only)
  const files = new Map<string, Set<string>>()
  for (const t of block.tools) {
    if (!t.tool_input || !t.tool_name) continue
    if (!['Read', 'Write', 'Edit'].includes(t.tool_name)) continue
    try {
      const inp  = JSON.parse(t.tool_input)
      const path = inp.file_path || inp.path
      if (path) {
        if (!files.has(path)) files.set(path, new Set())
        files.get(path)!.add(t.tool_name.toLowerCase())
      }
    } catch {}
  }

  // Bash commands (first 4)
  const bashCalls = block.tools
    .filter(t => t.tool_name === 'Bash' && t.tool_input)
    .slice(0, 4)
    .map(t => { try { return JSON.parse(t.tool_input!).command || '' } catch { return '' } })
    .filter(Boolean)

  // Tool count for loop detection
  const toolCountMap = new Map<string, number>()
  for (const t of block.tools) {
    if (t.tool_name) toolCountMap.set(t.tool_name, (toolCountMap.get(t.tool_name) || 0) + 1)
  }

  // Solo eventos con tool_name (excluye Cost/Human/etc.); in-progress = PreToolUse
  const visibleTools = block.tools.filter(t => t.tool_name && matchesFilter(t.tool_name, filter))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0d1117', overflow: 'hidden' }}>

      {/* ── Block header ── */}
      <div style={{
        borderBottom: '1px solid #21262d',
        flexShrink: 0,
        background: '#0d1117',
        padding: '12px 48px 10px',
      }}>
        <div style={{ maxWidth: 840, margin: '0 auto' }}>
          {/* Row 1: meta */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ color: '#6e7681', fontSize: 12, fontWeight: 600 }}>Bloque #{block.index}</span>
            {actors.map((a, i) => <ActorBadge key={i} actor={a} />)}
            {intent && <IntentBadge intent={intent} />}
            <div style={{ flex: 1 }} />
            {dur && (
              <span style={{ color: '#6e7681', fontSize: 12, background: '#161b22', borderRadius: 4, padding: '2px 8px', border: '1px solid #21262d' }}>
                {dur}
              </span>
            )}
            {inProg
              ? <Loader2 size={14} style={{ color: '#d29922', animation: 'spin 1s linear infinite' }} />
              : <CheckCircle2 size={14} style={{ color: '#3fb950aa' }} />
            }
          </div>
          {/* Row 2: dist + summary */}
          {stats.total > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ToolDistBar stats={stats} />
              <span style={{ color: '#484f58', fontSize: 11 }}>{summaryText(stats)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ padding: '20px 48px' }}>
      <div style={{ maxWidth: 840, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Duration Timeline ── */}
        {timedTools.length > 1 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: durOpen ? 8 : 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#484f58', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Duración por herramienta ({timedTools.length})
              </div>
              <button
                onClick={() => setDurOpen(v => !v)}
                style={{ background: 'none', border: '1px solid #21262d', borderRadius: 4, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', color: '#6e7681', fontSize: 10 }}
              >
                {durOpen ? <ChevronsDownUp size={10} /> : <ChevronsUpDown size={10} />}
                {durOpen ? 'ocultar' : 'mostrar'}
              </button>
            </div>
            {durOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {timedTools.map((t, i) => {
                  const color = TOOL_COLORS[t.tool_name || ''] || TOOL_COLORS.default
                  const Icon  = TOOL_ICONS[t.tool_name || ''] || TOOL_ICONS.default
                  const pct   = ((t.duration_ms ?? 0) / maxDur) * 100
                  const det   = detail(t.tool_name, t.tool_input)
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color, display: 'flex', alignItems: 'center', flexShrink: 0 }}><Icon size={11} /></span>
                      <span style={{ color: '#6e7681', fontSize: 10, width: 52, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.tool_name}
                      </span>
                      {det && (
                        <span style={{ color: '#3d444d', fontSize: 10, width: 96, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {det}
                        </span>
                      )}
                      <div style={{ flex: 1, background: '#161b22', borderRadius: 2, height: 7, overflow: 'hidden', position: 'relative' }}>
                        <div style={{
                          width: `${pct}%`, height: '100%',
                          background: `linear-gradient(90deg, ${color}cc, ${color}55)`,
                          borderRadius: 2, transition: 'width 0.4s ease',
                        }} />
                      </div>
                      <span style={{ color: '#6e7681', fontSize: 10, minWidth: 40, textAlign: 'right', flexShrink: 0 }}>
                        {fmtMs(t.duration_ms)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Files touched ── */}
        {files.size > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: filesOpen ? 8 : 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#484f58', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Archivos tocados ({files.size})
              </div>
              <button
                onClick={() => setFilesOpen(v => !v)}
                style={{ background: 'none', border: '1px solid #21262d', borderRadius: 4, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', color: '#6e7681', fontSize: 10 }}
              >
                {filesOpen ? <ChevronsDownUp size={10} /> : <ChevronsUpDown size={10} />}
                {filesOpen ? 'ocultar' : 'mostrar'}
              </button>
            </div>
            {filesOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {[...files.entries()].slice(0, 12).map(([path, ops]) => {
                  const hasWrite = ops.has('write') || ops.has('edit')
                  const short    = path.split('/').slice(-3).join('/')
                  return (
                    <div key={path} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 10px', borderRadius: 5,
                      background: hasWrite ? '#0e1f12' : '#0d1117',
                      border: `1px solid ${hasWrite ? '#3fb95022' : '#1e2329'}`,
                    }}>
                      <FileText size={11} style={{ color: hasWrite ? '#3fb950' : '#58a6ff', flexShrink: 0 }} />
                      <span style={{ color: '#8b949e', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={path}>
                        {short}
                      </span>
                      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                        {[...ops].map(op => (
                          <span key={op} style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                            color: op === 'read' ? '#58a6ff' : '#3fb950',
                            background: (op === 'read' ? '#58a6ff' : '#3fb950') + '18',
                            borderRadius: 3, padding: '1px 5px', textTransform: 'uppercase',
                          }}>{op}</span>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {files.size > 12 && (
                  <div style={{ color: '#484f58', fontSize: 11, paddingLeft: 8 }}>+{files.size - 12} más</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Bash commands ── */}
        {bashCalls.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: bashOpen ? 8 : 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#484f58', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Comandos ({bashCalls.length})
              </div>
              <button
                onClick={() => setBashOpen(v => !v)}
                style={{ background: 'none', border: '1px solid #21262d', borderRadius: 4, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', color: '#6e7681', fontSize: 10 }}
              >
                {bashOpen ? <ChevronsDownUp size={10} /> : <ChevronsUpDown size={10} />}
                {bashOpen ? 'ocultar' : 'mostrar'}
              </button>
            </div>
            {bashOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {bashCalls.map((cmd, i) => (
                  <div key={i} style={{
                    background: '#0d1117', border: '1px solid #21262d',
                    borderRadius: 5, padding: '5px 10px',
                    fontFamily: 'monospace', fontSize: 11, color: '#d29922',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} title={cmd}>
                    $ {cmd}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Cost breakdown ── */}
        {blockCost && totalCost > 0 && (
          <div>
            <SectionLabel>Costo</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: '#0c1520', border: '1px solid #58a6ff22', borderRadius: 7, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: '#58a6ff', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <ArrowDownLeft size={10} /> Input
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#58a6ff' }}>{fmtUsd(blockCost.inputUsd)}</div>
                {blockCost.inputTokens > 0 && (
                  <div style={{ fontSize: 10, color: '#58a6ff88', marginTop: 3 }}>
                    {fmtTokens(blockCost.inputTokens)}
                  </div>
                )}
              </div>
              <div style={{ background: '#0a1a0f', border: '1px solid #3fb95022', borderRadius: 7, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: '#3fb950', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <ArrowUpRight size={10} /> Output
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#3fb950' }}>{fmtUsd(blockCost.outputUsd)}</div>
                {blockCost.outputTokens > 0 && (
                  <div style={{ fontSize: 10, color: '#3fb95088', marginTop: 3 }}>
                    {fmtTokens(blockCost.outputTokens)}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Modelo real de la sesión + sub-agentes ── */}
        {sessionModel && (() => {
          const m = fmtModelBlock(sessionModel)
          // Detectar modelos de sub-agentes lanzados en este bloque
          const subModels: string[] = [...new Set(
            block.tools
              .filter(t => t.tool_name === 'Agent' && t.tool_input)
              .flatMap(t => {
                try { const inp = JSON.parse(t.tool_input!); return inp.model ? [inp.model as string] : [] }
                catch { return [] }
              })
              .filter(sm => !sessionModel.includes(sm) && sm !== sessionModel)
          )]
          return (
            <div>
              <SectionLabel>Modelo</SectionLabel>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {/* Modelo principal */}
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: m.color + '12', border: `1px solid ${m.color}25`,
                  borderRadius: 6, padding: '4px 10px',
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                  <span style={{ color: m.color, fontSize: 11, fontWeight: 700 }}>{m.name}</span>
                </div>
                {/* Sub-agentes con modelo diferente */}
                {subModels.map(sm => {
                  const s = fmtModelBlock(sm)
                  return (
                    <div key={sm} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      background: s.color + '12', border: `1px solid ${s.color}25`,
                      borderRadius: 6, padding: '4px 10px',
                    }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                      <span style={{ color: s.color, fontSize: 11, fontWeight: 700 }}>{s.name}</span>
                      <span style={{ color: s.color + '99', fontSize: 9, fontWeight: 500 }}>sub-agente</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* ── Tool log ── */}
        {block.tools.length > 0 && (
          <div>
            {/* Tool log header with filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <SectionLabel>Tool calls ({block.tools.length})</SectionLabel>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setLogOpen(v => !v)}
                style={{
                  background: 'none', border: '1px solid #21262d', borderRadius: 4,
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '1px 7px', color: '#6e7681', fontSize: 10,
                }}
              >
                {logOpen ? <ChevronsDownUp size={10} /> : <ChevronsUpDown size={10} />}
                {logOpen ? 'ocultar' : 'mostrar'}
              </button>
            </div>

            {logOpen && (
              <>
                {/* Inline filter */}
                <div style={{ display: 'flex', gap: 3, marginBottom: 8, flexWrap: 'wrap' }}>
                  {FILTER_LABELS.map(({ id, label, icon: Icon, color }) => {
                    const active = filter === id
                    return (
                      <button key={id} onClick={() => setFilter(id)} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 7px', borderRadius: 4,
                        fontSize: 10, fontWeight: active ? 600 : 400,
                        color: active ? color : '#6e7681',
                        background: active ? color + '18' : 'transparent',
                        border: active ? `1px solid ${color}40` : '1px solid transparent',
                        cursor: 'pointer',
                      }}>
                        <Icon size={9} />{label}
                      </button>
                    )
                  })}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {visibleTools.map((ev, i) => (
                    <ToolRow
                      key={i} ev={ev} startedAt={startedAt}
                      isLooping={(toolCountMap.get(ev.tool_name || '') || 0) >= 3}
                      onClick={() => setSelected(ev)}
                    />
                  ))}
                  {visibleTools.length === 0 && (
                    <div style={{ color: '#484f58', fontSize: 11, paddingLeft: 8 }}>sin resultados</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

      </div>
      </div>
      </div>

      {selected && <DetailModal ev={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TracePanel({ events, startedAt, cost, blockCosts = [], meta, quota, sessionState = 'idle', weeklyData = [], hiddenCost }: Props) {
  const listRef        = useRef<HTMLDivElement>(null)
  // null = auto-follow last block
  const [pinned, setPinned] = useState<number | null>(null)

  const blocks      = groupBlocks(events)
  const lastIdx     = blocks.length > 0 ? blocks[blocks.length - 1].index : 1
  const selectedIdx = pinned ?? lastIdx

  // Auto-scroll list to bottom when new block appears and not pinned
  useEffect(() => {
    if (pinned === null) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [blocks.length, pinned])

  const handleSelect = useCallback((blockIndex: number) => {
    const isLast = blocks.length > 0 && blockIndex === blocks[blocks.length - 1].index
    setPinned(isLast ? null : blockIndex)
  }, [blocks])

  const selectedBlock = blocks.find(b => b.index === selectedIdx) ?? blocks[blocks.length - 1]

  if (blocks.length === 0) {
    return (
      <div style={{ background: '#0d1117', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#484f58' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, opacity: 0.25 }}>
            <Terminal size={36} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#6e7681', marginBottom: 4 }}>Esperando actividad…</div>
          <div style={{ fontSize: 11 }}>Abre Claude Code y empieza a trabajar</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', flex: 1, background: '#0d1117', overflow: 'hidden' }}>
      <style>{`
        @keyframes spin        { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes borderPulse { 0%,100% { border-left-color: #d29922 } 50% { border-left-color: #d2992255 } }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.4)} }
        @keyframes ctxPulse { 0%,100%{opacity:1;box-shadow:0 0 4px #f8514988} 50%{opacity:.6;box-shadow:0 0 10px #f85149cc} }
      `}</style>

      {/* ── Left sidebar ── */}
      <div style={{
        width: 360, flexShrink: 0,
        borderRight: '1px solid #21262d',
        display: 'flex', flexDirection: 'column',
        background: '#090d12', overflow: 'hidden',
      }}>
        {/* KPI section */}
        <SidebarKPI cost={cost} quota={quota} sessionState={sessionState} meta={meta} />

        {/* Cost Timeline inside sidebar */}
        <CostTimeline blocks={blocks} blockCosts={blockCosts} selected={selectedIdx} onSelect={handleSelect} />

        {/* Block list (scrollable) */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', paddingTop: 4, paddingBottom: 4 }}>
          {blocks.map((block, idx) => (
            <BlockListItem
              key={block.index}
              block={block}
              blockCost={blockCosts[block.index - 1]}
              isLast={idx === blocks.length - 1}
              isSelected={block.index === selectedIdx}
              onClick={() => handleSelect(block.index)}
            />
          ))}

          {/* Loop summary */}
          {cost?.loops && cost.loops.length > 0 && (() => {
            const uniq = new Map<string, number>()
            for (const l of cost.loops) {
              if ((uniq.get(l.toolName) ?? 0) < l.count) uniq.set(l.toolName, l.count)
            }
            return (
              <div style={{ margin: '4px 8px', padding: '5px 10px', background: '#f8514910', border: '1px solid #f8514928', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                <TriangleAlert size={10} style={{ color: '#f85149', flexShrink: 0 }} />
                <span style={{ color: '#f85149', fontSize: 10, fontWeight: 600 }}>
                  {uniq.size} loop{uniq.size > 1 ? 's' : ''}
                </span>
                <span style={{ color: '#8b949e', fontSize: 10 }}>
                  — {[...uniq.entries()].map(([n, c]) => `${n} ×${c}`).join(' · ')}
                </span>
              </div>
            )
          })()}
        </div>

        {/* Session stats at bottom */}
        <SidebarStats cost={cost} weeklyData={weeklyData} events={events} hiddenCost={hiddenCost} />
      </div>

      {/* ── Right: block detail (full width) ── */}
      <div style={{ flex: 1, overflow: 'hidden', background: '#0d1117' }}>
        {selectedBlock
          ? (
            <BlockDetailPanel
              key={selectedBlock.index}
              block={selectedBlock}
              startedAt={startedAt}
              blockCost={blockCosts[selectedBlock.index - 1]}
              sessionModel={cost?.model}
            />
          )
          : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#484f58', fontSize: 12 }}>
              Seleccioná un bloque
            </div>
          )
        }
      </div>
    </div>
  )
}

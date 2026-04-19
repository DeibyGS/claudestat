import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
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
import type { TraceEvent, CostInfo, BlockCost, MetaStats, MetaAlert, QuotaData, SessionState, DayStats, QuotaStats } from '../types'
import { Tip } from './Tip'

interface HiddenCostStats {
  loop_waste_usd: number
  total_cost_usd: number
  loop_sessions:  number
  total_loops:    number
  total_sessions: number
}

interface SessionPromptItem { index: number; ts: number; text: string }

interface Props {
  events:        TraceEvent[]
  startedAt:     number
  cost?:         CostInfo
  blockCosts?:   BlockCost[]
  meta?:         MetaStats
  quota?:        QuotaData
  sessionState?: SessionState
  weeklyData:    DayStats[]
  prompts?:      SessionPromptItem[]
  hiddenCost?:   HiddenCostStats
  quotaStats?:   QuotaStats
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

const EFFICIENCY_CTX_WARN = 0.75   // threshold de advertencia de contexto (por debajo del compact 0.85)
const TOOL_CALL_WARN      = 150    // sesiones con más tool calls que esto se consideran intensivas
const CTX_CRITICAL_FREE   = 10     // % libre por debajo del cual se muestra alerta inline en sidebar
const EFFICIENCY_ALERT_COLOR = '#f85149'

// Colores con ratio de contraste ≥ 4.5:1 (WCAG AA) contra el fondo oscuro #0d1117
const TOOL_COLORS: Record<string, string> = {
  Read:      '#58a6ff',  // azul    — 7.9:1
  Write:     '#3fb950',  // verde   — 8.4:1
  Edit:      '#3fb950',  // verde   — 8.4:1
  Bash:      '#d29922',  // ámbar   — 6.9:1
  Glob:      '#79c0ff',  // azul claro — 10.5:1
  Grep:      '#79c0ff',  // azul claro — 10.5:1
  WebSearch: '#56d364',  // verde claro — 11.1:1
  WebFetch:  '#56d364',  // verde claro — 11.1:1
  Agent:     '#bc8cff',  // violeta — 6.5:1
  Skill:     '#58a6ff',  // azul    — 7.9:1
  TodoWrite: '#8b949e',  // gris    — 6.5:1
  TodoRead:  '#8b949e',  // gris    — 6.5:1
  Task:      '#8b949e',  // gris    — 6.5:1
  default:   '#8b949e',  // era #6e7681 (4.0:1, fallaba WCAG AA) → subido a 6.5:1
}

// ─── Enmascaramiento de datos sensibles ──────────────────────────────────────
// Reemplaza valores que parecen secretos (API keys, tokens, passwords) con ****
// para evitar que aparezcan en claro en el dashboard.

const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*["']?([A-Za-z0-9_\-]{16,})["']?/gi,
  /(?:sk|pk|rk|token|secret|password|passwd|pwd|auth|bearer)\s*[:=]\s*["']?([A-Za-z0-9_\-\.]{16,})["']?/gi,
  /\b(sk-[A-Za-z0-9]{20,})\b/g,       // OpenAI / Anthropic keys
  /\b(ghp_[A-Za-z0-9]{36})\b/g,       // GitHub personal access tokens
  /\b(xoxb-[A-Za-z0-9\-]+)\b/g,       // Slack bot tokens
  /\bAKIA[0-9A-Z]{16}\b/g,            // AWS Access Key IDs
]

export function maskSecrets(text: string): string {
  let result = text
  for (const re of SECRET_PATTERNS) {
    result = result.replace(re, (match, captured) =>
      captured ? match.replace(captured, '****') : '****'
    )
  }
  return result
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

function fmtJson(raw?: string | object): string {
  if (!raw) return ''
  if (typeof raw !== 'string') return JSON.stringify(raw, null, 2)
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
          {ev.tool_output && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#3fb950', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                Output
              </div>
              <pre style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '10px 12px', fontSize: 11, color: '#c9d1d9', margin: 0, overflow: 'auto', maxHeight: 260, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {maskSecrets(ev.tool_output)}
              </pre>
            </div>
          )}
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

function SidebarKPI({ cost, quota, sessionState = 'idle', meta, quotaStats, startedAt }: {
  cost?:         CostInfo
  quota?:        QuotaData
  sessionState?: SessionState
  meta?:         MetaStats
  quotaStats?:   QuotaStats
  startedAt?:    number
}) {
  const sm = STATE_META[sessionState]

  const COMPACT_THRESHOLD = 0.85
  const compactWindow = cost?.context_window ? Math.round(cost.context_window * COMPACT_THRESHOLD) : null
  const contextPct = cost?.context_used && compactWindow
    ? Math.min(100, Math.round(cost.context_used / compactWindow * 100)) : null
  const ctxFree    = contextPct !== null ? 100 - contextPct : null
  const ctxColor   = ctxFree === null ? '#484f58'
    : ctxFree < 15 ? '#f85149' : ctxFree < 35 ? '#d29922' : '#3fb950'

  const quotaColor = !quota ? '#484f58'
    : quota.cyclePct > 85 ? '#f85149' : quota.cyclePct > 65 ? '#d29922' : '#58a6ff'

  const alerts: MetaAlert[] = []
  if (meta?.alerts) alerts.push(...meta.alerts)
  if (contextPct !== null && contextPct > 85)
    alerts.push({ level: 'critical', message: `Auto-compact muy pronto — ${ctxFree}% libre`, metric: 'context' })
  else if (contextPct !== null && contextPct > 65)
    alerts.push({ level: 'warning', message: `Contexto al ${contextPct}%`, metric: 'context' })

  const resetMs = quota
    ? (quota.cycleResetAt ? quota.cycleResetAt - Date.now() : quota.cycleResetMs)
    : 0

  return (
    <div style={{ borderBottom: '1px solid #21262d', flexShrink: 0, background: '#090d12' }}>

      {/* ── Fila estado + burn rate ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px 6px',
        borderBottom: '1px solid #161b22',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {sm.pulse && (
            <span style={{
              width: 7, height: 7, borderRadius: '50%', background: sm.color,
              display: 'inline-block', boxShadow: `0 0 5px ${sm.color}`,
              animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0,
            }} />
          )}
          <span style={{ color: sm.color, fontSize: 12, fontWeight: 700, letterSpacing: '-0.2px' }}>
            {sm.label}
          </span>
        </div>
        {quota && quota.burnRateTokensPerMin > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Flame size={9} color="#d29922" />
            <span style={{ fontSize: 10, color: '#d29922', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {cost?.projected_hourly_usd
                && cost.projected_hourly_usd > 0.001
                && cost.projected_hourly_usd < 50
                && startedAt
                && (Date.now() - startedAt) > 2 * 60_000
                ? `~${fmtUsd(cost.projected_hourly_usd)}/h`
                : `${quota.burnRateTokensPerMin.toLocaleString()} tok/min`
              }
            </span>
          </div>
        )}
      </div>

      {/* ── Contexto ── */}
      <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid #161b22' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
          <Tip position="bottom" align="left" content={
            <div style={{ fontSize: 11, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: ctxColor, marginBottom: 4 }}>Ventana de contexto</div>
              <div style={{ color: '#7d8590' }}>% calculado sobre umbral de auto-compact (~85% de la ventana total)</div>
              <div style={{ color: '#7d8590', marginTop: 4 }}>Igual a "X% until auto-compact" en Claude Code CLI</div>
              <div style={{ color: '#484f58', marginTop: 6, fontSize: 10 }}>
                Total: <span style={{ color: '#e6edf3' }}>{fmtTok(cost?.context_window ?? 200_000)}</span>
                {'  ·  '}Umbral: <span style={{ color: '#e6edf3' }}>{fmtTok(compactWindow ?? 170_000)}</span>
              </div>
            </div>
          }>
            <span style={{ fontSize: 10, color: '#6e7681', cursor: 'default', display: 'flex', alignItems: 'center', gap: 4 }}>
              <BrainCircuit size={10} color="#484f58" />
              Contexto
            </span>
          </Tip>
          <span style={{ fontSize: 13, fontWeight: 700, color: ctxColor, fontVariantNumeric: 'tabular-nums' }}>
            {ctxFree !== null ? `${ctxFree}% libre` : '—'}
          </span>
        </div>
        <div style={{ height: 5, background: '#161b22', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
          {contextPct !== null && (
            <div style={{
              width: `${contextPct}%`, height: '100%', background: ctxColor,
              borderRadius: 3, transition: 'width 0.5s',
              boxShadow: ctxFree !== null && ctxFree < 20 ? `0 0 6px ${ctxColor}88` : undefined,
              animation: ctxFree !== null && ctxFree < 20 ? 'ctxPulse 1.2s ease-in-out infinite' : undefined,
            }} />
          )}
        </div>
        {cost?.context_used && (
          <div style={{ fontSize: 9, color: '#484f58', display: 'flex', gap: 6 }}>
            <span>{fmtTok(cost.context_used)} usados</span>
            <span style={{ color: '#3d444d' }}>·</span>
            <span>compact @{fmtTok(compactWindow ?? 170_000)}</span>
          </div>
        )}
        {ctxFree !== null && ctxFree < CTX_CRITICAL_FREE && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, padding: '3px 6px', background: `${EFFICIENCY_ALERT_COLOR}15`, border: `1px solid ${EFFICIENCY_ALERT_COLOR}35`, borderRadius: 4 }}>
            <TriangleAlert size={9} color={EFFICIENCY_ALERT_COLOR} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: EFFICIENCY_ALERT_COLOR, fontWeight: 600 }}>
              Auto-compact inminente — solo {ctxFree}% libre
            </span>
          </div>
        )}
      </div>


      {/* ── Modelos semana ── */}
      {quota && (quota.weeklyHoursSonnet > 0 || quota.weeklyHoursOpus > 0) && (
        <div style={{ padding: '7px 12px 7px' }}>
          <div style={{ fontSize: 10, color: '#484f58', marginBottom: 5 }}>Esta semana</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <ModelBarMini label="Sonnet" color="#58a6ff" hours={quota.weeklyHoursSonnet} limit={quota.weeklyLimitSonnet} />
            {quota.weeklyLimitOpus > 0 && (
              <ModelBarMini label="Opus" color="#d29922" hours={quota.weeklyHoursOpus} limit={quota.weeklyLimitOpus} />
            )}
            {(quota.weeklyHoursHaiku ?? 0) > 0 && (
              <ModelBarMini label="Haiku" color="#3fb950" hours={quota.weeklyHoursHaiku!} limit={0} />
            )}
          </div>
        </div>
      )}

      {/* ── P90 reference ── */}
      {quotaStats && quotaStats.sessionCount >= 5 && (
        <div style={{ padding: '6px 12px 4px', borderTop: '1px solid #161b22' }}>
          <div style={{ fontSize: 9, color: '#484f58', marginBottom: 3 }}>Tu uso típico (P90)</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{ fontSize: 10, color: '#6e7681' }}>{fmtTok(quotaStats.p90Tokens ?? 0)} tokens</span>
            <span style={{ color: '#3d444d', fontSize: 10 }}>·</span>
            <span style={{ fontSize: 10, color: '#6e7681' }}>~${(quotaStats.p90Cost ?? 0).toFixed(2)}</span>
            <span style={{ color: '#3d444d', fontSize: 10 }}>·</span>
            <span style={{ fontSize: 9, color: '#3d444d' }}>{quotaStats.sessionCount} sesiones</span>
          </div>
        </div>
      )}

      {/* ── Alertas ── */}
      {alerts.length > 0 && (
        <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {alerts.slice(0, 2).map((a, i) => {
            const c = ({ info: '#58a6ff', warning: '#d29922', critical: '#f85149' } as const)[a.level]
            const AlertIcon = ALERT_ICON[a.level] ?? Info
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 10, color: c,
                background: c + '15', border: `1px solid ${c}30`,
                borderRadius: 4, padding: '3px 8px',
              }}>
                <AlertIcon size={9} />
                <span>{a.message}</span>
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

// Devuelve bullets explicando por qué la eficiencia es baja.
// Cada razón es accionable: describe el síntoma + su impacto en tokens/costo.
function deriveEfficiencyReasons(
  cost: CostInfo,
  events: TraceEvent[],
  prompts: SessionPromptItem[],
): string[] {
  const reasons: string[] = []
  const toolCallCount = events.filter(e => e.type === 'Done').length

  if (cost.loops.length > 0) {
    const top     = cost.loops.slice(0, 2).map(l => `${l.toolName} ×${l.count}`).join(', ')
    const extra   = cost.loops.length > 2 ? ` +${cost.loops.length - 2} más` : ''
    reasons.push(`Bucles detectados: ${top}${extra} — Claude repitio las mismas llamadas sin avanzar`)
  }

  if (toolCallCount > TOOL_CALL_WARN) {
    reasons.push(`${toolCallCount} herramientas ejecutadas — sesiones largas acumulan contexto previo y elevan el costo por turno`)
  }

  const ctxPct = cost.context_used && cost.context_window
    ? cost.context_used / cost.context_window : 0
  if (ctxPct > EFFICIENCY_CTX_WARN) {
    reasons.push(`Contexto al ${Math.round(ctxPct * 100)}% — Claude lee más historial en cada respuesta, disparando los tokens de entrada`)
  }

  if (prompts.length > 0) {
    const avgLen = prompts.reduce((s, p) => s + p.text.length, 0) / prompts.length
    if (avgLen > 600) {
      reasons.push(`Prompts largos (~${Math.round(avgLen)} chars de media) — mensajes muy detallados aumentan el contexto de entrada`)
    }
  }

  if (cost.cost_usd > 10) {
    reasons.push(`Costo elevado ($${cost.cost_usd.toFixed(2)}) — señal de sesión intensiva; revisar si hay iteraciones innecesarias`)
  }

  return reasons
}

function EfficiencyAlert({ cost, events, prompts }: {
  cost:    CostInfo
  events:  TraceEvent[]
  prompts: SessionPromptItem[]
}) {
  const [open, setOpen] = useState(false)
  const reasons = useMemo(
    () => deriveEfficiencyReasons(cost, events, prompts),
    [cost, events, prompts],
  )
  if (reasons.length === 0) return null
  const c = EFFICIENCY_ALERT_COLOR
  return (
    <div style={{ background: `${c}10`, border: `1px solid ${c}30`, borderLeft: `2px solid ${c}`, borderRadius: 5, padding: '5px 8px' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', padding: 0, display: 'flex', alignItems: 'center', gap: 5 }}
      >
        <TriangleAlert size={9} color={c} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: c, fontWeight: 600, flex: 1, textAlign: 'left' }}>Eficiencia baja — {reasons.length} causa{reasons.length > 1 ? 's' : ''}</span>
        {open ? <ChevronsDownUp size={9} color={c} /> : <ChevronsUpDown size={9} color={c} />}
      </button>
      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {reasons.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'flex-start' }}>
              <span style={{ color: c, fontSize: 10, flexShrink: 0, marginTop: 1 }}>·</span>
              <span style={{ fontSize: 10, color: '#8b949e', lineHeight: 1.5 }}>{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SidebarStats({ cost, weeklyData, events, hiddenCost, prompts = [] }: {
  cost?:       CostInfo
  weeklyData:  DayStats[]
  events:      TraceEvent[]
  hiddenCost?: HiddenCostStats
  prompts?:    SessionPromptItem[]
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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

              {score !== null && score < 70 && cost && <EfficiencyAlert cost={cost} events={events} prompts={prompts} />}
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
        }}>
          <Tip position="top" align="left" content={
            <div style={{ fontSize: 11, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: '#d29922', marginBottom: 4 }}>Coste oculto en loops</div>
              <div style={{ color: '#7d8590' }}>Estimación de dinero perdido en repeticiones innecesarias de herramientas.</div>
              <div style={{ color: '#484f58', marginTop: 6 }}>
                <div>{hiddenCost.loop_sessions} sesiones con loops detectados</div>
                <div>{hiddenCost.total_loops} loops · {hiddenCost.total_sessions} sesiones totales</div>
                <div style={{ marginTop: 4 }}>Fórmula: <span style={{ color: '#7d8590', fontFamily: 'monospace', fontSize: 10 }}>costo × (loops / tool_calls)</span></div>
              </div>
            </div>
          }>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'default' }}>
              <Flame size={9} color="#d29922" />
              <span style={{ fontSize: 9, color: '#7d8590', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>coste oculto 7d</span>
            </div>
          </Tip>
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
  const [hovered, setHovered] = useState<{ idx: number; x: number; side: 'left' | 'right' } | null>(null)

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
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 3, height: BAR_MAX }}>
        {blocks.map((block, i) => {
          const cost    = costs[i]
          const bc      = blockCosts[block.index - 1]
          const inProg  = !block.hasStop && i === blocks.length - 1
          const isSel   = block.index === selected
          const isMax   = cost === maxCost && cost > 0
          const barH    = cost > 0 ? Math.max(4, (cost / maxCost) * BAR_MAX) : 4
          const color   = inProg ? '#d29922' : isSel ? '#58a6ff' : '#1f6feb'
          return (
            <div
              key={block.index}
              onClick={() => onSelect(block.index)}
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
              onMouseEnter={e => {
                e.currentTarget.style.opacity = '1'
                const rect = e.currentTarget.getBoundingClientRect()
                const parent = e.currentTarget.parentElement!.getBoundingClientRect()
                const x = rect.left - parent.left + rect.width / 2
                setHovered({ idx: i, x, side: x > parent.width / 2 ? 'right' : 'left' })
              }}
              onMouseLeave={e => {
                e.currentTarget.style.opacity = isSel ? '1' : isMax ? '0.85' : '0.45'
                setHovered(null)
              }}
            />
          )
        })}
        {/* Floating tooltip */}
        {hovered !== null && (() => {
          const i   = hovered.idx
          const bc  = blockCosts[blocks[i].index - 1]
          const c   = costs[i]
          const totTok = bc ? bc.inputTokens + bc.outputTokens : 0
          return (
            <div style={{
              position: 'absolute',
              bottom: BAR_MAX + 6,
              left: hovered.side === 'left' ? hovered.x : undefined,
              right: hovered.side === 'right' ? `calc(100% - ${hovered.x}px)` : undefined,
              transform: hovered.side === 'left' ? 'translateX(-30%)' : 'translateX(30%)',
              background: '#1c2128',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '6px 8px',
              fontSize: 10,
              color: '#c9d1d9',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 10,
              lineHeight: 1.7,
            }}>
              <div style={{ fontWeight: 700, color: '#e6edf3', marginBottom: 2 }}>
                #{blocks[i].index} — {c > 0 ? fmtUsd(c) : 'sin datos'}
              </div>
              {bc && (
                <>
                  <div style={{ color: '#8b949e' }}>
                    <span style={{ color: '#79c0ff' }}>In</span>{'  '}
                    {fmtTok(bc.inputTokens)} tok · {fmtUsd(bc.inputUsd)}
                  </div>
                  <div style={{ color: '#8b949e' }}>
                    <span style={{ color: '#56d364' }}>Out</span>{'  '}
                    {fmtTok(bc.outputTokens)} tok · {fmtUsd(bc.outputUsd)}
                  </div>
                  <div style={{ borderTop: '1px solid #21262d', marginTop: 3, paddingTop: 3, color: '#6e7681' }}>
                    Total {fmtTok(totTok)} tok
                  </div>
                </>
              )}
            </div>
          )
        })()}
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

// Prioridad: selected > inProgress > heatRole > default
function getBlockColors(isSelected: boolean, inProgress: boolean, heatRole?: 'max' | 'min') {
  if (isSelected)         return { border: '#58a6ff40', borderLeft: '#58a6ff', bg: '#161d2d', bgHover: '#161d2d', cost: '#79c0ff' }
  if (inProgress)         return { border: '#d2992240', borderLeft: '#d29922', bg: '#1c1a14', bgHover: '#1c1a14', cost: '#d29922' }
  if (heatRole === 'max') return { border: '#f8514928', borderLeft: '#f85149', bg: '#160e0e', bgHover: '#1e0f0f', cost: '#f85149' }
  if (heatRole === 'min') return { border: '#3fb95028', borderLeft: '#3fb950', bg: '#0d160e', bgHover: '#0f1e10', cost: '#3fb950' }
  return                         { border: '#1e2329',   borderLeft: '#30363d', bg: '#111519', bgHover: '#161b22', cost: '#6e7681' }
}

function BlockListItem({
  block, blockCost, isLast, isSelected, heatRole, onClick,
}: {
  block:      Block
  blockCost?: BlockCost
  isLast:     boolean
  isSelected: boolean
  heatRole?:  'max' | 'min'
  onClick:    () => void
}) {
  const inProgress = !block.hasStop && isLast
  const actors     = extractActors(block.tools)
  const stats      = calcStats(block.tools)
  const intent     = getIntent(stats)
  const dur        = blockDuration(block)
  const totalCost = blockCost ? blockCost.inputUsd + blockCost.outputUsd : 0
  const clr       = getBlockColors(isSelected, inProgress, heatRole)

  return (
    <div
      onClick={onClick}
      style={{
        margin: '4px 8px',
        borderRadius: 7,
        border: `1px solid ${clr.border}`,
        borderLeft: `3px solid ${clr.borderLeft}`,
        background: clr.bg,
        padding: '8px 10px',
        cursor: 'pointer',
        transition: 'background 0.12s, border-color 0.12s',
        animation: inProgress ? 'borderPulse 2s ease-in-out infinite' : undefined,
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = clr.bgHover }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = clr.bg }}
    >
      {/* Row 1: index + actors + cost + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        <span style={{ color: '#484f58', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>#{block.index}</span>
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', minWidth: 0, flex: 1, overflow: 'hidden' }}>
          {actors.slice(0, 1).map((a, i) => <ActorBadge key={i} actor={a} />)}
          {actors.length > 1 && <span style={{ fontSize: 9, color: '#6e7681' }}>+{actors.length - 1}</span>}
        </div>
        {totalCost > 0 && (
          <span style={{ color: clr.cost, fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
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
        {blockCost && (blockCost.inputTokens + blockCost.outputTokens) > 0 && (
          <span style={{ color: '#484f58', fontSize: 10, flexShrink: 0 }}>
            {fmtTok(blockCost.inputTokens + blockCost.outputTokens)}
          </span>
        )}
        {dur && <span style={{ color: '#3d444d', fontSize: 10, flexShrink: 0, marginLeft: 4 }}>· {dur}</span>}
      </div>
    </div>
  )
}

// ─── Tool Row ─────────────────────────────────────────────────────────────────

function ToolRow({
  ev, startedAt, typeCount, isRealLoop, onClick, blockDone,
}: {
  ev:          TraceEvent
  startedAt:   number
  typeCount:   number   // veces que aparece este tipo de tool en el bloque (diversas entradas)
  isRealLoop:  boolean  // mismo tool + misma entrada repetida ≥2 veces
  onClick:     () => void
  blockDone:   boolean  // true = bloque completo (tiene Stop) → click habilitado
}) {
  const done      = ev.type === 'Done'
  // Solo permite abrir el modal si la herramienta terminó Y el bloque está completo
  const clickable = done && blockDone
  const Icon  = TOOL_ICONS[ev.tool_name || ''] || TOOL_ICONS.default
  const color = done ? (TOOL_COLORS[ev.tool_name || ''] || TOOL_COLORS.default) : '#6e7681'
  const det   = detail(ev.tool_name, ev.tool_input)

  return (
    <div
      onClick={clickable ? onClick : undefined}
      title={!done ? 'En progreso…' : !blockDone ? 'Disponible cuando el bloque termine' : 'Click para ver input/output'}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 12px 4px 16px',
        borderLeft: `2px solid ${done ? color + '50' : '#21262d'}`,
        marginLeft: 8,
        opacity: done ? (blockDone ? 1 : 0.5) : 0.6,
        cursor: clickable ? 'pointer' : 'default',
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
      {isRealLoop && (
        <Tip position="top" align="right" content={
          <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
            <span style={{ color: '#d29922', fontWeight: 700 }}>Llamada repetida</span><br />
            <span style={{ color: '#e6edf3' }}>{ev.tool_name}</span> fue invocada con<br />
            exactamente la misma entrada ≥2 veces —<br />
            posible bucle sin avance real
          </div>
        }>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#d29922', fontSize: 10, fontWeight: 700, background: '#d2992218', borderRadius: 3, padding: '1px 5px', flexShrink: 0, cursor: 'help' }}>
            <TriangleAlert size={9} /> repetida
          </span>
        </Tip>
      )}
      {!isRealLoop && typeCount >= 3 && (
        <Tip position="top" align="right" content={
          <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
            <span style={{ color: '#e6edf3', fontWeight: 700 }}>{ev.tool_name}</span> fue llamada <span style={{ color: '#e6edf3' }}>{typeCount} veces</span> en este bloque<br />
            con entradas distintas — uso intensivo normal, no un bucle
          </div>
        }>
          <span style={{ color: '#484f58', fontSize: 10, fontVariantNumeric: 'tabular-nums', flexShrink: 0, cursor: 'help' }}>
            ×{typeCount}
          </span>
        </Tip>
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


// ─── Prompt Score ─────────────────────────────────────────────────────────────

type ScoreLevel = 'ok' | 'warn' | 'error'
interface PromptCheck { label: string; level: ScoreLevel; tip?: string }

function scorePrompt(text: string): PromptCheck[] {
  const checks: PromptCheck[] = []

  // 1. Longitud
  if (text.length > 600) {
    checks.push({ label: `Muy largo · ${text.length} chars`, level: 'error',
      tip: 'Divide en pasos: envía primero la acción principal y luego los ajustes en mensajes separados.' })
  } else if (text.length > 300) {
    checks.push({ label: `Moderado · ${text.length} chars`, level: 'warn',
      tip: 'Considera separar en dos mensajes si tienes más de una solicitud.' })
  } else {
    checks.push({ label: `Conciso · ${text.length} chars`, level: 'ok' })
  }

  // 2. Ambigüedad (frases vagas sin contexto)
  const vagueRe = /\b(arréglalo|arreglalo|fix it|make it work|mejóralo|mejoralo|improve it|make it better|algo así|somehow|whatever|haz que funcione|que funcione|que ande|hazlo funcionar|that it works|it's broken)\b/i
  if (vagueRe.test(text)) {
    checks.push({ label: 'Ambiguo', level: 'warn',
      tip: 'Describe el error exacto o el comportamiento esperado. Ejemplo: "falla con TypeError en línea 42" en vez de "arréglalo".' })
  }

  // 3. Multi-tarea (demasiadas solicitudes en uno)
  const alsoCount  = (text.match(/\b(también|además|y también|and also|otra cosa|por otro lado|ademas)\b/gi) || []).length
  const bulletCount = (text.match(/^[-*•]\s/gm) || []).length + (text.match(/^\d+\.\s/gm) || []).length
  if (alsoCount >= 2 || bulletCount >= 4) {
    checks.push({ label: `Multi-tarea · ${alsoCount + bulletCount} indicadores`, level: 'warn',
      tip: 'Demasiadas solicitudes de una vez. Claude prioriza la primera — envía el resto en mensajes separados.' })
  }

  // 4. Especificidad (menciona rutas, funciones, errores → positivo)
  const hasPath  = /\/[\w\-./]+\.\w{2,4}/.test(text)
  const hasFunc  = /\b(function|función|método|method|class|clase|endpoint|route|ruta|hook|component|componente)\s+[\w]+/i.test(text)
  const hasError = /\b(Error|error|exception|Exception|undefined|null|Cannot|FAILED|TypeError|cannot read)\b/.test(text)
  const hasLine  = /\blínea\s+\d+|line\s+\d+|:\d+:\d+\b/.test(text)
  if (hasPath || hasFunc || hasError || hasLine) {
    checks.push({ label: 'Específico', level: 'ok' })
  } else if (text.length > 100) {
    checks.push({ label: 'Poco específico', level: 'warn',
      tip: 'Incluye el nombre del archivo, función o mensaje de error exacto para un mejor resultado.' })
  }

  return checks
}

const SCORE_COLORS: Record<ScoreLevel, string> = { ok: '#3fb950', warn: '#d29922', error: '#f85149' }

function PromptScoreCard({ prompt }: { prompt: string }) {
  const [open,     setOpen]     = useState(false)
  const [expanded, setExpanded] = useState(false)
  const checks = scorePrompt(prompt)
  const worstLevel = checks.some(c => c.level === 'error') ? 'error'
    : checks.some(c => c.level === 'warn') ? 'warn' : 'ok'
  const recs = checks.filter(c => c.tip)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: open ? 8 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#484f58', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Prompt
          </span>
          {/* Score badges */}
          <div style={{ display: 'flex', gap: 4 }}>
            {checks.map((c, i) => (
              <span key={i} style={{
                fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 10,
                background: SCORE_COLORS[c.level] + '22',
                color: SCORE_COLORS[c.level],
                border: `1px solid ${SCORE_COLORS[c.level]}44`,
              }}>{c.label}</span>
            ))}
          </div>
        </div>
        <button
          onClick={() => setOpen(v => !v)}
          style={{ background: 'none', border: `1px solid ${SCORE_COLORS[worstLevel]}44`, borderRadius: 4, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', color: SCORE_COLORS[worstLevel], fontSize: 10 }}
        >
          {open ? <ChevronsDownUp size={10} /> : <ChevronsUpDown size={10} />}
          {open ? 'ocultar' : 'ver'}
        </button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Prompt text */}
          <div style={{ position: 'relative' }}>
            <div style={{
              background: '#0d1117', border: '1px solid #21262d', borderRadius: 6,
              padding: '10px 12px 28px',
              maxHeight: expanded ? undefined : 120,
              overflow: expanded ? 'auto' : 'hidden',
              WebkitMaskImage: expanded ? undefined : 'linear-gradient(to bottom, black 55%, transparent 100%)',
            }}>
              <span style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {prompt}
              </span>
            </div>
            <button
              onClick={() => setExpanded(v => !v)}
              style={{
                position: 'absolute', bottom: 6, right: 8,
                background: '#21262d', border: '1px solid #30363d', borderRadius: 4,
                cursor: 'pointer', fontSize: 10, color: '#8b949e',
                padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              {expanded ? <ChevronsDownUp size={9} /> : <ChevronsUpDown size={9} />}
              {expanded ? 'colapsar' : 'ver todo'}
            </button>
          </div>
          {/* Recommendations */}
          {recs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {recs.map((c, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 8, padding: '6px 10px',
                  background: SCORE_COLORS[c.level] + '0d',
                  border: `1px solid ${SCORE_COLORS[c.level]}33`,
                  borderLeft: `3px solid ${SCORE_COLORS[c.level]}`,
                  borderRadius: 5,
                }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: SCORE_COLORS[c.level], flexShrink: 0, marginTop: 1 }}>
                    {c.label.split('·')[0].trim().toUpperCase()}
                  </span>
                  <span style={{ fontSize: 10, color: '#7d8590', lineHeight: 1.5 }}>{c.tip}</span>
                </div>
              ))}
            </div>
          )}
          {recs.length === 0 && (
            <div style={{ fontSize: 10, color: '#3fb95099', paddingLeft: 4 }}>✓ Prompt bien estructurado</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Block Detail Panel ───────────────────────────────────────────────────────

function BlockDetailPanel({
  block, startedAt, blockCost, sessionModel, prompt,
}: {
  block:         Block
  startedAt:     number
  blockCost?:    BlockCost
  sessionModel?: string
  prompt?:       string
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

  // block.tools es inmutable por bloque — memoizar evita recomputo en cada render
  const { toolTypeCount, realLoopKeys, realLoopCount } = useMemo(() => {
    const toolTypeCount = new Map<string, number>()
    const exactCount    = new Map<string, number>()
    for (const t of block.tools) {
      if (!t.tool_name) continue
      toolTypeCount.set(t.tool_name, (toolTypeCount.get(t.tool_name) || 0) + 1)
      const key = `${t.tool_name}::${t.tool_input ?? ''}`
      exactCount.set(key, (exactCount.get(key) || 0) + 1)
    }
    const realLoopKeys = new Set<string>()
    for (const [k, n] of exactCount) {
      if (n >= 2) realLoopKeys.add(k)
    }
    return { toolTypeCount, realLoopKeys, realLoopCount: realLoopKeys.size }
  }, [block.tools])

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
              {realLoopCount > 0 && (
                <span style={{ fontSize: 10, fontWeight: 600, color: '#d29922', background: '#d2992215', border: '1px solid #d2992230', borderRadius: 4, padding: '1px 6px' }}>
                  {realLoopCount} llamada{realLoopCount > 1 ? 's' : ''} repetida{realLoopCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ padding: '20px 48px' }}>
      <div style={{ maxWidth: 840, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Prompt Score ── */}
        {prompt && block.hasStop && (
          <PromptScoreCard prompt={prompt} />
        )}

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
                      typeCount={toolTypeCount.get(ev.tool_name || '') || 0}
                      isRealLoop={realLoopKeys.has(`${ev.tool_name}::${ev.tool_input ?? ''}`)}
                      blockDone={block.hasStop}
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

export function TracePanel({ events, startedAt, cost, blockCosts = [], meta, quota, sessionState = 'idle', weeklyData = [], hiddenCost, prompts = [], quotaStats }: Props) {
  const listRef        = useRef<HTMLDivElement>(null)
  // null = auto-follow last block
  const [pinned, setPinned] = useState<number | null>(null)

  // Memoizar groupBlocks: es O(n) sobre events y no debe recalcularse en renders sin cambios
  const blocks    = useMemo(() => groupBlocks(events), [events])
  // Single-pass: finds max y min cost en un solo loop, solo bloques completados con tools
  const { maxCostIdx, minCostIdx } = useMemo(() => {
    let maxIdx = -1, minIdx = -1, maxCost = -Infinity, minCost = Infinity, eligible = 0
    for (const block of blocks) {
      if (!block.hasStop || block.tools.length === 0) continue
      const bc   = blockCosts[block.index - 1]
      const cost = (bc?.inputUsd ?? 0) + (bc?.outputUsd ?? 0)
      if (cost <= 0) continue
      eligible++
      if (cost > maxCost) { maxCost = cost; maxIdx = block.index }
      if (cost < minCost) { minCost = cost; minIdx = block.index }
    }
    return { maxCostIdx: maxIdx, minCostIdx: eligible > 1 ? minIdx : -1 }
  }, [blocks, blockCosts])
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
        <SidebarKPI cost={cost} quota={quota} sessionState={sessionState} meta={meta} quotaStats={quotaStats} startedAt={startedAt} />

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
              heatRole={block.index === maxCostIdx ? 'max' : block.index === minCostIdx ? 'min' : undefined}
              onClick={() => handleSelect(block.index)}
            />
          ))}

        </div>

        {/* Session stats at bottom */}
        <SidebarStats cost={cost} weeklyData={weeklyData} events={events} hiddenCost={hiddenCost} prompts={prompts} />
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
              prompt={prompts.find(p => p.index === selectedBlock.index)?.text}
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

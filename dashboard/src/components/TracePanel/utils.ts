import type { TraceEvent } from '../../types'
import {
  FileText, FilePlus, Pencil, Terminal, FolderSearch, Search,
  Globe, Bot, Zap, ListTodo, ClipboardList, Wrench,
  Filter,
  type LucideIcon,
} from 'lucide-react'

// ─── Shared interfaces ────────────────────────────────────────────────────────

export interface HiddenCostStats {
  loop_waste_usd: number
  total_cost_usd: number
  loop_sessions:  number
  total_loops:    number
  total_sessions: number
}

export interface SessionPromptItem { index: number; ts: number; text: string }

export interface Block {
  index:   number
  tools:   TraceEvent[]
  hasStop: boolean
  endTs?:  number
}

export interface Actor {
  label: string; color: string; type: 'claude' | 'agent' | 'skill'
}

export interface ToolStats {
  read: number; write: number; bash: number
  agent: number; web: number; other: number
  total: number
}

// ─── Tool categories ──────────────────────────────────────────────────────────

export const CAT_COLORS = {
  read:  '#58a6ff',
  write: '#3fb950',
  bash:  '#d29922',
  agent: '#bc8cff',
  web:   '#56d364',
  other: '#484f58',
} as const
export type Cat = keyof typeof CAT_COLORS

export function categorize(toolName?: string): Cat {
  if (!toolName) return 'other'
  if (['Read', 'Glob', 'Grep', 'TodoRead', 'ToolSearch'].includes(toolName)) return 'read'
  if (['Write', 'Edit', 'TodoWrite'].includes(toolName))                      return 'write'
  if (toolName === 'Bash')                                                     return 'bash'
  if (['Agent', 'Skill', 'Task', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop'].includes(toolName)) return 'agent'
  if (['WebSearch', 'WebFetch'].includes(toolName))                            return 'web'
  return 'other'
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

export function checkDangerous(toolName?: string, rawInput?: string): string | null {
  if (toolName !== 'Bash' || !rawInput) return null
  try {
    const cmd: string = JSON.parse(rawInput).command || ''
    const match = DANGEROUS_PATTERNS.find(p => p.re.test(cmd))
    return match ? match.label : null
  } catch { return null }
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

export function groupBlocks(events: TraceEvent[]): Block[] {
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

export function extractActors(tools: TraceEvent[]): Actor[] {
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
    return [{ label: 'Claude', color: '#e06c39', type: 'claude' }]
  const result: Actor[] = []
  if (hasDirect) result.push({ label: 'Claude', color: '#e06c39', type: 'claude' })
  for (const a of agents) result.push({ label: a, color: '#bc8cff', type: 'agent' })
  for (const s of skills) result.push({ label: `/${s}`, color: '#58a6ff', type: 'skill' })
  return result
}

export function blockDuration(block: Block): string {
  if (!block.hasStop || !block.endTs || block.tools.length === 0) return ''
  const ms = block.endTs - block.tools[0].ts
  if (ms < 1000)  return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

export function fmtUsd(usd: number): string {
  if (usd < 0.00005) return '<$0.0001'
  if (usd < 0.01)    return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(3)}`
}

export function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

export function estimateCacheSavings(cacheRead: number, model?: string): number {
  if (cacheRead === 0) return 0
  if (model?.includes('opus'))  return cacheRead * 13.50 / 1_000_000
  if (model?.includes('haiku')) return cacheRead *  0.72 / 1_000_000
  return cacheRead * 2.70 / 1_000_000
}

export function relTs(base: number, ts: number): string {
  const diff = ts - base
  const s = Math.floor(diff / 1000); const ms = diff % 1000
  return `${String(s).padStart(2, '0')}:${String(ms).padStart(3, '0')}`
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tokens`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K tokens`
  return `${n} tokens`
}

export function fmtMs(ms?: number): string {
  if (!ms) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function trunc(s: string, n = 44): string {
  return s.length > n ? s.slice(0, n - 3) + '…' : s
}

export function detail(toolName?: string, rawInput?: string): string {
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

export function fmtJson(raw?: string | object): string {
  if (!raw) return ''
  if (typeof raw !== 'string') return JSON.stringify(raw, null, 2)
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

export function fmtResetMs(ms: number): string {
  if (ms <= 0) return 'ahora'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function calcStats(tools: TraceEvent[]): ToolStats {
  const s: ToolStats = { read: 0, write: 0, bash: 0, agent: 0, web: 0, other: 0, total: 0 }
  for (const t of tools) {
    if (!t.tool_name) continue
    s[categorize(t.tool_name)]++
    s.total++
  }
  return s
}

export function getIntent(stats: ToolStats): { label: string; color: string } | null {
  if (stats.total === 0) return null
  const { read, write, bash, agent } = stats
  if (agent > 0 && agent / stats.total >= 0.3) return { label: 'Delegando',     color: '#bc8cff' }
  if (write === 0 && bash === 0 && read > 0)   return { label: 'Explorando',    color: '#58a6ff' }
  if (write / stats.total > 0.4)               return { label: 'Implementando', color: '#3fb950' }
  if (bash > 0 && read > 0)                    return { label: 'Debugging',     color: '#d29922' }
  if (write > 0 || bash > 0)                   return { label: 'Edit+Cmd',   color: '#8b949e' }
  return null
}

export function summaryText(stats: ToolStats): string {
  const parts: string[] = []
  if (stats.read  > 0) parts.push(`${stats.read} read`)
  if (stats.write > 0) parts.push(`${stats.write} write`)
  if (stats.bash  > 0) parts.push(`${stats.bash} bash`)
  if (stats.agent > 0) parts.push(`${stats.agent} agent`)
  if (stats.web   > 0) parts.push(`${stats.web} web`)
  if (stats.other > 0) parts.push(`${stats.other} other`)
  return parts.join(' · ')
}

export function fmtModelBlock(model: string): { name: string; color: string } {
  if (model.includes('opus'))   return { name: 'Opus 4.6',   color: '#d29922' }
  if (model.includes('haiku'))  return { name: 'Haiku 4.5',  color: '#3fb950' }
  if (model.includes('sonnet')) return { name: 'Sonnet 4.6', color: '#58a6ff' }
  return { name: model.replace('claude-', '').split('-').slice(0, 2).join(' '), color: '#8b949e' }
}

export function getSkillName(ev: TraceEvent): string {
  try { const inp = JSON.parse(ev.tool_input || '{}'); return inp.skill || inp.name || 'skill' }
  catch { return 'skill' }
}

// ─── Filter ───────────────────────────────────────────────────────────────────

export type FilterType = 'all' | 'read' | 'write' | 'bash' | 'agent' | 'skill' | 'web'

export const FILTER_GROUPS: Record<FilterType, string[]> = {
  all:   [],
  read:  ['Read', 'Glob', 'Grep', 'ToolSearch'],
  write: ['Write', 'Edit'],
  bash:  ['Bash'],
  agent: ['Agent', 'Task', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop'],
  skill: ['Skill'],
  web:   ['WebSearch', 'WebFetch'],
}

export function matchesFilter(toolName: string | undefined, filter: FilterType): boolean {
  if (filter === 'all' || !toolName) return true
  return FILTER_GROUPS[filter].includes(toolName)
}

// RenderItem type used in BlockListItem / BlockDetailPanel
export type RenderItem =
  | { kind: 'tool'; ev: TraceEvent }
  | { kind: 'skillGroup'; skillEv: TraceEvent; children: TraceEvent[] }

export function buildRenderItems(tools: TraceEvent[], filter: FilterType): RenderItem[] {
  const skillsWithChildren = new Set(tools.filter(t => t.skill_parent).map(t => t.skill_parent!))
  const items: RenderItem[] = []
  for (const ev of tools) {
    if (!ev.tool_name || !matchesFilter(ev.tool_name, filter)) continue
    if (ev.skill_parent) continue  // rendered inside skill group
    if (ev.tool_name === 'Skill' && ev.type === 'Done') {
      const name = getSkillName(ev)
      if (skillsWithChildren.has(name)) {
        const children = tools.filter(t => t.skill_parent === name && !!t.tool_name && matchesFilter(t.tool_name, filter))
        items.push({ kind: 'skillGroup', skillEv: ev, children })
        continue
      }
    }
    items.push({ kind: 'tool', ev })
  }
  return items
}

// ─── Icon + Color maps ────────────────────────────────────────────────────────

export const TOOL_ICONS: Record<string, LucideIcon> = {
  Read:        FileText,
  Write:       FilePlus,
  Edit:        Pencil,
  Bash:        Terminal,
  Glob:        FolderSearch,
  Grep:        Search,
  ToolSearch:  Search,
  WebSearch:   Globe,
  WebFetch:    Globe,
  Agent:       Bot,
  Skill:       Zap,
  TodoWrite:   ListTodo,
  TodoRead:    ListTodo,
  Task:        ClipboardList,
  TaskCreate:  ClipboardList,
  TaskUpdate:  ClipboardList,
  TaskGet:     ClipboardList,
  TaskList:    ClipboardList,
  TaskOutput:  ClipboardList,
  TaskStop:    ClipboardList,
  default:     Wrench,
}

// Colores con ratio de contraste ≥ 4.5:1 (WCAG AA) contra el fondo oscuro #0d1117
export const TOOL_COLORS: Record<string, string> = {
  Read:        '#58a6ff',  // azul       — 7.9:1
  Write:       '#3fb950',  // verde      — 8.4:1
  Edit:        '#3fb950',  // verde      — 8.4:1
  Bash:        '#d29922',  // ámbar      — 6.9:1
  Glob:        '#79c0ff',  // azul claro — 10.5:1
  Grep:        '#79c0ff',  // azul claro — 10.5:1
  ToolSearch:  '#79c0ff',  // azul claro — 10.5:1
  WebSearch:   '#56d364',  // verde claro — 11.1:1
  WebFetch:    '#56d364',  // verde claro — 11.1:1
  Agent:       '#bc8cff',  // violeta    — 6.5:1
  Skill:       '#58a6ff',  // azul       — 7.9:1
  TodoWrite:   '#8b949e',  // gris       — 6.5:1
  TodoRead:    '#8b949e',  // gris       — 6.5:1
  Task:        '#8b949e',  // gris       — 6.5:1
  TaskCreate:  '#8b949e',
  TaskUpdate:  '#8b949e',
  TaskGet:     '#8b949e',
  TaskList:    '#8b949e',
  TaskOutput:  '#8b949e',
  TaskStop:    '#8b949e',
  default:     '#8b949e',  // era #6e7681 (4.0:1, fallaba WCAG AA) → subido a 6.5:1
}

export const FILTER_LABELS: { id: FilterType; label: string; icon: LucideIcon; color: string }[] = [
  { id: 'all',   label: 'All',  icon: Filter,   color: '#8b949e' },
  { id: 'read',  label: 'Read',  icon: FileText,  color: '#58a6ff' },
  { id: 'write', label: 'Write', icon: Pencil,    color: '#3fb950' },
  { id: 'bash',  label: 'Bash',  icon: Terminal,  color: '#d29922' },
  { id: 'agent', label: 'Agent', icon: Bot,       color: '#bc8cff' },
  { id: 'skill', label: 'Skill', icon: Zap,       color: '#58a6ff' },
  { id: 'web',   label: 'Web',   icon: Globe,     color: '#56d364' },
]

// ─── Constants used across modules ───────────────────────────────────────────

export const EFFICIENCY_CTX_WARN   = 0.75   // threshold de advertencia de contexto (por debajo del compact 0.85)
export const TOOL_CALL_WARN        = 150    // sesiones con más tool calls que esto se consideran intensivas
export const CTX_CRITICAL_FREE     = 10     // % libre por debajo del cual se muestra alerta inline en sidebar
export const EFFICIENCY_ALERT_COLOR = '#f85149'

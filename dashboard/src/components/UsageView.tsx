import { BarChart2, Shield, AlertTriangle, TrendingUp, Lightbulb, CheckCircle2, TriangleAlert, Info, XCircle, Activity, MessageSquare, Wrench, Cpu, Flame, BrainCircuit, Zap, Calendar, Clock } from 'lucide-react'
import type { QuotaData, CostInfo, TraceEvent, ClaudeStatsData } from '../types'
import { Tip } from './Tip'

// ─── Precios por millón de tokens ─────────────────────────────────────────────
const PRICE_PER_M = {
  sonnet: 6.6,   // blended ~70% input / 30% output
  haiku:  1.76,
  opus:   33.0,
}
// Cache savings per million tokens (full input price - cached price)
function cacheSavingsPerM(model?: string): number {
  if (model?.includes('opus'))  return 13.50  // $15/M → $1.50/M cached
  if (model?.includes('haiku')) return 0.22   // $0.25/M → $0.03/M cached
  return 2.70                                  // Sonnet: $3/M → $0.30/M cached
}

function getModelPrice(model: string): number {
  if (model.includes('opus'))  return PRICE_PER_M.opus
  if (model.includes('haiku')) return PRICE_PER_M.haiku
  return PRICE_PER_M.sonnet
}

function getModelShortName(model: string): string {
  if (model.includes('opus'))  return 'Opus'
  if (model.includes('haiku')) return 'Haiku'
  return 'Sonnet'
}

interface SessionPrompt { index: number; ts: number; text: string }

interface Props {
  quota?:       QuotaData
  cost?:        CostInfo
  events?:      TraceEvent[]
  prompts?:     SessionPrompt[]
  claudeStats?: ClaudeStatsData
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}
function fmtUsd(n: number): string {
  if (n === 0)    return '$0.00'
  if (n < 0.001)  return '<$0.001'
  if (n < 0.01)   return `$${n.toFixed(4)}`
  if (n < 1)      return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

// ─── Coach: detección de loops por bloque ─────────────────────────────────────

type TipLevel = 'error' | 'warning' | 'info' | 'success'
interface CoachTip {
  level:        TipLevel
  title:        string
  text:         string
  prompt?:      string   // prompt del usuario que originó el problema
  blockIndex?:  number   // bloque de referencia (para navegación)
}

interface LoopOccurrence {
  blockIndex: number   // número del bloque (1-based)
  toolName:   string
  count:      number
  detail?:    string   // archivo o comando específico
  multiFile:  boolean  // true = distintos archivos en el loop
}

// Detects consecutive runs of the same tool per block
function detectLoopsFromEvents(events: TraceEvent[], threshold = 5): LoopOccurrence[] {
  const results: LoopOccurrence[] = []
  let blockIdx = 0
  let blockTools: TraceEvent[] = []

  function analyzeBlock(idx: number, tools: TraceEvent[]) {
    if (tools.length === 0) return
    let i = 0
    while (i < tools.length) {
      const name = tools[i].tool_name!
      let j = i + 1
      while (j < tools.length && tools[j].tool_name === name) j++
      const count = j - i
      if (count >= threshold) {
        const slice = tools.slice(i, j)
        // Extraer detalle según tool
        let detail: string | undefined
        let multiFile = false
        if (['Read', 'Edit', 'Write', 'Glob', 'Grep'].includes(name)) {
          const files = new Set<string>()
          for (const t of slice) {
            try {
              const inp = JSON.parse(t.tool_input || '{}')
              const p = inp.file_path || inp.pattern || inp.path || ''
              if (p) files.add(p.split('/').pop() || p)
            } catch {}
          }
          multiFile = files.size > 1
          detail = files.size === 1 ? [...files][0] : files.size > 1 ? `${files.size} different files` : undefined
          // Parallel reads of different files is normal — only flag same-file re-reads or very high counts
          if (multiFile && count < 6) { i = j; continue }
        } else if (name.includes('mem_save')) {
          // Only flag if the same topic is saved repeatedly — different topics = intentional behavior, not a loop
          const topics = new Set<string>()
          for (const t of slice) {
            try { const inp = JSON.parse(t.tool_input || '{}'); if (inp.topic) topics.add(inp.topic) } catch {}
          }
          multiFile = topics.size > 1
          detail = topics.size === 1 ? [...topics][0] : undefined
          if (multiFile) { i = j; continue }
        } else if (name === 'Bash') {
          try {
            const cmd: string = JSON.parse(slice[0].tool_input || '{}').command || ''
            detail = cmd.length > 50 ? cmd.slice(0, 48) + '…' : cmd
          } catch {}
        }
        results.push({ blockIndex: idx + 1, toolName: name, count, detail, multiFile })
      }
      i = j
    }
  }

  for (const ev of events) {
    if (ev.type === 'Stop') {
      analyzeBlock(blockIdx, blockTools)
      blockIdx++
      blockTools = []
    } else if ((ev.type === 'Done' || ev.type === 'PreToolUse') && ev.tool_name) {
      blockTools.push(ev)
    }
  }
  if (blockTools.length > 0) analyzeBlock(blockIdx, blockTools)
  return results
}

// Specific advice per tool type
function loopAdvice(toolName: string, multiFile: boolean, detail?: string): string {
  switch (toolName) {
    case 'Read':
      if (multiFile)
        return `Claude is reading different files in sequence without processing information between reads. Group exploration with Glob/Grep first to reduce the number of Reads.`
      return `"${detail || 'the file'}" was read multiple times in a row. Use offset+limit to read only the necessary section, or Grep to search without reading the entire file. Re-reading the same file wastes context tokens.`
    case 'Edit':
      return `"${detail || 'the file'}" was edited multiple times in a row. This happens when instructions are imprecise — Claude attempts the edit, fails or it doesn't match expectations, and retries. Be more specific: indicate the exact change (old_string → new_string) instead of describing the result.`
    case 'Write':
      return `"${detail || 'the file'}" was overwritten multiple times. Consolidate all changes into a single instruction instead of writing intermediate versions.`
    case 'Bash':
      return `Repeated command: "${detail || '…'}". Bash loops are usually retries due to error. Verify that the previous command succeeded before continuing, or ask Claude to show the error output.`
    case 'Grep':
    case 'Glob':
      return `Repeated searches with similar patterns. Claude is searching for something it can't find. Try a broader pattern or use Read to see the directory structure directly.`
    default:
      if (toolName.includes('mem_save'))
        return `The same topic "${detail || '…'}" was saved in Engram multiple times in a row. Use mem_update to edit an existing observation instead of creating duplicates.`
      return `The tool ${toolName} was executed multiple times in a row. Check if Claude is ignoring previous results.`
  }
}

function generateTips(cost?: CostInfo, quota?: QuotaData, events?: TraceEvent[], prompts?: SessionPrompt[]): CoachTip[] {
  const tips: CoachTip[] = []

  // 1. Loops por bloque (desde eventos — más granular que cost.loops)
  if (events && events.length > 0) {
    const loopOccurrences = detectLoopsFromEvents(events, 5)

    // Group by tool to avoid repeating the same type of warning
    const byTool = new Map<string, LoopOccurrence[]>()
    for (const o of loopOccurrences) {
      const arr = byTool.get(o.toolName) || []
      arr.push(o)
      byTool.set(o.toolName, arr)
    }

    for (const [toolName, occs] of byTool) {
      const blockRefs  = occs.map(o => `#${o.blockIndex}`).join(', ')
      const totalCount = occs.reduce((s, o) => s + o.count, 0)
      const first      = occs[0]
      // Prompt that triggered the first block with loop (block N → prompt index N)
      const triggerPrompt = prompts?.find(p => p.index === first.blockIndex)?.text
      tips.push({
        level:       'error',
        title:       `Loop: ${toolName} ×${totalCount} — bloques ${blockRefs}`,
        text:        loopAdvice(toolName, first.multiFile, first.detail),
        prompt:      triggerPrompt,
        blockIndex:  first.blockIndex,
      })
    }
  } else if (cost?.loops && cost.loops.length > 0) {
    // Fallback if we don't have events
    for (const l of cost.loops) {
      tips.push({
        level: 'error',
        title: `Loop: ${l.toolName} ×${l.count}`,
        text: loopAdvice(l.toolName, false),
      })
    }
  }

  // 2. Re-reads (same file ≥3 times, NOT consecutive — pattern distinct from loop)
  if (events && events.length > 0) {
    const readCounts = new Map<string, number>()
    for (const e of events) {
      if (e.tool_name === 'Read' && e.type === 'Done' && e.tool_input) {
        try {
          const fp: string = JSON.parse(e.tool_input).file_path || ''
          if (fp) readCounts.set(fp, (readCounts.get(fp) || 0) + 1)
        } catch {}
      }
    }
    const reReads = [...readCounts.entries()].filter(([, c]) => c >= 5)
    if (reReads.length > 0) {
      const names = reReads.map(([f, c]) => `${f.split('/').pop()} (×${c})`).join(', ')
      tips.push({
        level: 'warning',
        title: `Scattered re-reads: ${reReads.length} file${reReads.length > 1 ? 's' : ''}`,
        text: `${names}. These reads are not consecutive but add up to many context tokens. Consider saving the structure mentally before continuing to edit, or use Grep instead of reading the entire file.`,
      })
    }
  }

  // 3. Low cache hit
  if (cost) {
    const total = cost.input_tokens + cost.cache_read + cost.cache_creation
    const hitRate = total > 5000 ? cost.cache_read / total : -1
    if (hitRate >= 0 && hitRate < 0.30) {
      tips.push({
        level: 'warning',
        title: `Low cache hit: ${Math.round(hitRate * 100)}%`,
        text: 'Claude caches context automatically in long sessions. Avoid manually clearing history and work in continuous sessions to accumulate cache.',
      })
    }
  }

  // 4. Low efficiency
  if (cost && cost.efficiency_score > 0 && cost.efficiency_score < 70) {
    tips.push({
      level: 'warning',
      title: `Low efficiency: ${cost.efficiency_score}/100`,
      text: 'Loops and re-reads are consuming tokens unnecessarily. Check if Claude is repeating steps or if instructions are ambiguous.',
    })
  }

  // 5. High burn rate
  if (quota && quota.burnRateTokensPerMin > 6000) {
    tips.push({
      level: 'info',
      title: `High burn rate: ${quota.burnRateTokensPerMin.toLocaleString()} tok/min`,
      text: 'You are consuming tokens very quickly. Consider asking for more concise responses, avoid attaching large complete files, or break the task into steps.',
    })
  }

  // 6. Bash overuse
  if (events && events.length > 0) {
    const done = events.filter(e => e.type === 'Done')
    const bashCount = done.filter(e => e.tool_name === 'Bash').length
    const readCount = done.filter(e => e.tool_name === 'Read').length
    const grepCount = done.filter(e => e.tool_name === 'Grep').length
    if (bashCount > 6 && grepCount < Math.floor(bashCount * 0.3) && readCount > 4) {
      tips.push({
        level: 'info',
        title: `Bash+Read without Grep (${bashCount} Bash, ${readCount} Read)`,
        text: 'You are combining Bash and Read to search for information. Grep is more efficient for searching within files — use Grep before Read when you don\'t know what line something is on.',
      })
    }
  }

  // 7. High quota
  if (quota && quota.cyclePct > 70) {
    tips.push({
      level: quota.cyclePct > 85 ? 'error' : 'warning',
      title: `Quota at ${quota.cyclePct}%`,
      text: `You used ${quota.cyclePrompts}/${quota.cycleLimit} prompts in the 5h window. Group several changes in a single message instead of sending one by one.`,
    })
  }

  // 8. Best practices
  if (cost && cost.cache_read > 30_000) {
    const savings = (cost.cache_read / 1_000_000) * cacheSavingsPerM(cost.model)
    if (savings > 0.02) {
      tips.push({
        level: 'success',
        title: `Optimal cache — saving ${fmtUsd(savings)}`,
        text: 'You are making good use of prompt cache. Long and continuous sessions maximize savings.',
      })
    }
  }
  if (cost && cost.efficiency_score >= 90) {
    tips.push({
      level: 'success',
      title: `Excellent efficiency: ${cost.efficiency_score}/100`,
      text: 'No loops detected in this session. Good work pace.',
    })
  }

  return tips
}

// ─── Componentes de sección ────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#161b22', border: '1px solid #21262d', borderRadius: 8,
      padding: '14px 16px', ...style,
    }}>
      {children}
    </div>
  )
}

function CardHeader({ icon: Icon, title, subtitle, color = '#58a6ff' }: {
  icon: React.ElementType; title: string; subtitle?: string; color?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
      <Icon size={13} color={color} />
      <span style={{ fontSize: 12, color: '#e6edf3', fontWeight: 700 }}>{title}</span>
      {subtitle && <span style={{ fontSize: 10, color: '#484f58', marginLeft: 2 }}>{subtitle}</span>}
    </div>
  )
}

function InfoTip({ content, position = 'bottom', align = 'left', style }: {
  content:   React.ReactNode
  position?: 'top' | 'bottom'
  align?:    'left' | 'right'
  style?:    React.CSSProperties
}) {
  return (
    <Tip position={position} align={align} content={content}>
      <Info size={9} color="#3d444d" style={{ cursor: 'help', ...style }} />
    </Tip>
  )
}

// ─── Card: Estado actual (contexto + cuota + reset) ────────────────────────────

function StatusCard({ quota, cost }: { quota: QuotaData; cost?: CostInfo }) {
  // Contexto
  const ctxUsed       = cost?.context_used ?? 0
  const ctxWindow     = cost?.context_window ?? 200_000
  const compactWindow = Math.round(ctxWindow * 0.85)
  const ctxPct   = ctxUsed > 0 && compactWindow > 0 ? Math.min(100, Math.round(ctxUsed / compactWindow * 100)) : null
  const ctxFree  = ctxPct !== null ? 100 - ctxPct : null
  const ctxColor = ctxFree === null ? '#484f58'
    : ctxFree < 20 ? '#f85149' : ctxFree < 40 ? '#d29922' : '#3fb950'

  // Sesión actual
  const sessionCost = cost?.cost_usd ?? 0
  const inputTok    = cost?.input_tokens ?? 0
  const outputTok   = cost?.output_tokens ?? 0
  const cacheRead   = cost?.cache_read ?? 0

  // Modelo + burn rate
  const model    = cost?.model ?? null
  const burnRate = quota.burnRateTokensPerMin ?? 0
  const shortModel = model
    ? model.replace('claude-', '').replace(/-\d{8}$/, '')
    : null

  return (
    <Card style={{ borderColor: '#30363d' }}>
      <CardHeader icon={Activity} title="Current status" subtitle="real-time" color="#58a6ff" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>

        {/* Contexto */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
            <BrainCircuit size={10} color="#484f58" />
            <span style={{ fontSize: 10, color: '#484f58', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Context</span>
            <InfoTip position="bottom" align="left" content={
              <div>
                <div style={{ color: '#58a6ff', fontWeight: 700, fontSize: 11, marginBottom: 4 }}>Free context space</div>
                <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.6 }}>
                  Percentage available before Claude activates auto-compact.<br />
                  Compact occurs at 85% of the window limit (normally 200K tokens).<br />
                  <span style={{ color: '#d29922' }}>Below 20%: consider using /clear.</span>
                </div>
              </div>
            } />
          </div>
          {ctxFree !== null ? (
            <>
              <div style={{ fontSize: 26, fontWeight: 700, color: ctxColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {ctxFree}%
              </div>
              <div style={{ fontSize: 9, color: ctxColor, opacity: 0.7, lineHeight: 1, marginBottom: 4 }}>free</div>
              <div style={{ fontSize: 9, color: '#484f58', marginBottom: 6 }}>{Math.round(ctxUsed / 1000)}k used · limit {Math.round(compactWindow / 1000)}k</div>
              <div style={{ width: '100%', height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${ctxPct}%`, height: '100%', background: ctxColor, borderRadius: 2, transition: 'width 0.5s' }} />
              </div>
              <div style={{ fontSize: 9, color: '#3d444d', marginTop: 4 }}>
                {ctxFree < 20 ? '⚠ Consider /clear soon' : ctxFree < 40 ? 'Moderate — ok for now' : 'No context pressure'}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#484f58' }}>Waiting for data…</div>
          )}
        </div>

        {/* Current session */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
            <Activity size={10} color="#484f58" />
            <span style={{ fontSize: 10, color: '#484f58', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current session</span>
            <InfoTip position="bottom" align="left" content={
              <div>
                <div style={{ color: '#58a6ff', fontWeight: 700, fontSize: 11, marginBottom: 4 }}>Cost of this session</div>
                <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.6 }}>
                  Accumulated from the first message of the active session.<br />
                  <span style={{ color: '#79c0ff' }}>in</span> = tokens sent to Claude (context + message).<br />
                  <span style={{ color: '#56d364' }}>out</span> = tokens generated by Claude.<br />
                  cache = tokens reused (~10× cheaper than fresh input).
                </div>
              </div>
            } />
          </div>
          {sessionCost > 0 ? (
            <>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#e6edf3', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {fmtUsd(sessionCost)}
              </div>
              <div style={{ fontSize: 9, color: '#484f58', marginTop: 6, lineHeight: 2 }}>
                <span style={{ color: '#79c0ff' }}>in</span> {fmtTok(inputTok)}
                {cacheRead > 0 && <span style={{ color: '#3d444d' }}> · {fmtTok(cacheRead)} cache</span>}
                <br />
                <span style={{ color: '#56d364' }}>out</span> {fmtTok(outputTok)}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#484f58' }}>No active session</div>
          )}
        </div>

        {/* Model */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
            <Cpu size={10} color="#484f58" />
            <span style={{ fontSize: 10, color: '#484f58', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Model</span>
            <InfoTip position="bottom" align="right" content={
              <div>
                <div style={{ color: '#58a6ff', fontWeight: 700, fontSize: 11, marginBottom: 4 }}>Active model</div>
                <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.6 }}>
                  Claude model used in the current session.<br />
                  The <span style={{ color: '#d29922' }}>burn rate</span> indicates tokens consumed per minute in real time — useful for estimating how long the quota will last before the next 5h reset.
                </div>
              </div>
            } />
          </div>
          {shortModel ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#e6edf3', lineHeight: 1.3 }}>
                {shortModel}
              </div>
              <div style={{ fontSize: 9, color: '#3d444d', marginTop: 3, wordBreak: 'break-all' }}>{model}</div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#484f58' }}>—</div>
          )}
          {burnRate > 0 && (
            <Tip position="top" align="right" content={
              <div>
                <div style={{ color: '#d29922', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>Current burn rate</div>
                <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                  Tokens consumed per minute in this session.<br />
                  High burn rate = large context or long responses.<br />
                  More than 6,000 tok/min can drain quota quickly.
                </div>
              </div>
            }>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, cursor: 'help' }}>
                <Flame size={9} color="#d29922" />
                <span style={{ fontSize: 10, color: '#d29922', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {burnRate.toLocaleString()} tok/min
                </span>
              </div>
            </Tip>
          )}
        </div>

      </div>
    </Card>
  )
}

// ─── Card: Actividad de hoy (stats-cache.json) ────────────────────────────────

function DailyActivityCard({ stats }: { stats: ClaudeStatsData }) {
  const day   = stats.today
  const label = stats.todayLabel
  const last7 = stats.last7

  if (!day && last7.messages === 0) {
    return (
      <Card>
        <CardHeader icon={Activity} title="Activity (stats-cache.json)" />
        <span style={{ fontSize: 12, color: '#484f58' }}>No data yet in stats-cache.json</span>
      </Card>
    )
  }

  const cols = [
    {
      label: 'Messages', icon: MessageSquare, today: day?.messages ?? 0, week: last7.messages, color: '#58a6ff',
      tooltip: 'Total messages (human + assistant).\nDivide by 2 to estimate real prompts.\nSource: ~/.claude/stats-cache.json',
    },
    {
      label: 'Sessions', icon: Clock, today: day?.sessions ?? 0, week: last7.sessions, color: '#3fb950',
      tooltip: 'Different conversations started with Claude Code.\nEach time you run "claude" in a directory counts as a session.',
    },
    {
      label: 'Tools', icon: Wrench, today: day?.tools ?? 0, week: last7.tools, color: '#d29922',
      tooltip: 'Tool calls executed (Read, Edit, Bash, Grep…).\nHigh number indicates code-intensive sessions.',
    },
    {
      label: 'Out tokens', icon: Zap, today: day?.outputTokens ?? 0, week: last7.outputTokens, color: '#a371f7', fmt: fmtTok,
      tooltip: 'Tokens generated by Claude in responses.\nThese most influence session cost.',
    },
  ]

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Calendar size={13} color="#58a6ff" />
          <span style={{ fontSize: 12, color: '#e6edf3', fontWeight: 700 }}>Activity</span>
          {label && <span style={{ fontSize: 10, color: '#484f58', marginLeft: 2 }}>{label} / 7 days</span>}
        </div>
        {stats.cacheDate && (
          <span style={{ fontSize: 9, color: '#3d444d' }}>cache: {stats.cacheDate}</span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, justifyItems: 'center' }}>
        {cols.map(col => {
          const fmt = (col as any).fmt ?? ((n: number) => n.toLocaleString())
          return (
            <Tip
              key={col.label}
              position="bottom"
              content={
                <div>
                  <div style={{ color: col.color, fontWeight: 700, fontSize: 11, marginBottom: 4 }}>{col.label}</div>
                  <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{col.tooltip}</div>
                </div>
              }
            >
              <div style={{ textAlign: 'center', cursor: 'help' }}>
                <col.icon size={11} color={col.color} style={{ marginBottom: 4 }} />
                <div style={{ fontSize: 9, color: '#6e7681', marginBottom: 2, fontWeight: 600 }}>{col.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: col.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(col.today)}
                </div>
                <div style={{ fontSize: 9, color: '#484f58', marginBottom: 4 }}>{label ?? '—'}</div>
                <div style={{ fontSize: 11, color: '#6e7681', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(col.week)}
                </div>
                <div style={{ fontSize: 9, color: '#3d444d' }}>7 days</div>
              </div>
            </Tip>
          )
        })}
      </div>
      <div style={{ fontSize: 9, color: '#3d444d', marginTop: 10 }}>
        Source: ~/.claude/stats-cache.json · Messages include human + assistant (÷2 ≈ real prompts) · {stats.allTime.sessions} total sessions
      </div>
      {stats.cacheIsStale && (
        <div style={{ fontSize: 9, color: '#d29922', marginTop: 4 }}>
          ⚠ Stale cache ({stats.cacheDate}) — Claude Code updates this file when each CLI session ends
        </div>
      )}
    </Card>
  )
}

// ─── Card: Modelos esta semana ─────────────────────────────────────────────────

function ModelCard({ quota }: { quota: QuotaData }) {
  const rows = [
    { label: 'Sonnet', color: '#58a6ff', hours: quota.weeklyHoursSonnet, limit: quota.weeklyLimitSonnet, tokens: quota.weeklyTokensSonnet ?? 0, price: PRICE_PER_M.sonnet },
    { label: 'Haiku',  color: '#3fb950', hours: quota.weeklyHoursHaiku,  limit: 0,                       tokens: quota.weeklyTokensHaiku  ?? 0, price: PRICE_PER_M.haiku  },
    { label: 'Opus',   color: '#d29922', hours: quota.weeklyHoursOpus,   limit: quota.weeklyLimitOpus,   tokens: quota.weeklyTokensOpus   ?? 0, price: PRICE_PER_M.opus   },
  ].filter(r => r.hours > 0 || r.tokens > 0)

  const totalCost = rows.reduce((s, r) => s + (r.tokens / 1_000_000) * r.price, 0)
  const totalTok  = rows.reduce((s, r) => s + r.tokens, 0)

  return (
    <Card>
      <CardHeader icon={BarChart2} title="Models this week" />
      {rows.length === 0 ? (
        <span style={{ fontSize: 12, color: '#484f58' }}>No activity this week</span>
      ) : (
        <>
          {rows.map(r => {
            const pct     = r.limit > 0 ? Math.min(100, (r.hours / r.limit) * 100) : 0
            const estCost = (r.tokens / 1_000_000) * r.price
            const tokPct  = totalTok > 0 ? Math.round((r.tokens / totalTok) * 100) : 0
            return (
              <div key={r.label} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Tip position="bottom" align="left" content={
                    <div>
                      <div style={{ color: r.color, fontWeight: 700, fontSize: 11, marginBottom: 3 }}>{r.label}</div>
                      <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                        Estimated price: ~${r.price}/M tokens (blended input/output)<br />
                        Hours = 5 min windows where Claude used this model<br />
                        {r.limit > 0 ? `Max weekly limit: ${r.limit}h` : 'No weekly limit configured'}
                      </div>
                    </div>
                  }><span style={{ width: 46, fontSize: 11, color: r.color, fontWeight: 700, flexShrink: 0, cursor: 'help' }}>{r.label}</span></Tip>
                  <span style={{ fontSize: 13, color: '#e6edf3', fontWeight: 600 }}>{r.hours > 0 ? `${r.hours}h` : '—'}</span>
                  {r.limit > 0 && <span style={{ fontSize: 10, color: '#484f58' }}>/ {r.limit}h</span>}
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: '#6e7681' }}>{fmtTok(r.tokens)}</span>
                  <span style={{ fontSize: 10, color: '#3d444d' }}>·</span>
                  <span style={{ fontSize: 10, color: '#484f58' }}>{tokPct}%</span>
                  <span style={{ fontSize: 10, color: '#3fb950', marginLeft: 4 }}>~{fmtUsd(estCost)}</span>
                </div>
                {r.limit > 0 && r.hours > 0 && (
                  <div style={{ height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: pct > 85 ? '#f85149' : pct > 65 ? '#d29922' : r.color, borderRadius: 2 }} />
                  </div>
                )}
                {r.limit === 0 && r.tokens > 0 && (
                  <div style={{ height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${tokPct}%`, height: '100%', background: r.color + 'aa', borderRadius: 2 }} />
                  </div>
                )}
              </div>
            )
          })}
          <div style={{ borderTop: '1px solid #21262d', paddingTop: 8, marginTop: 4, display: 'flex', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>{fmtTok(totalTok)} tokens</div>
              <div style={{ fontSize: 9, color: '#484f58' }}>total week</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#3fb950' }}>~{fmtUsd(totalCost)}</div>
              <div style={{ fontSize: 9, color: '#484f58' }}>estimated cost</div>
            </div>
          </div>
          <div style={{ fontSize: 9, color: '#3d444d', marginTop: 6 }}>
            Hours = 5 min active windows · Tokens = input + output · Estimated blended price
          </div>
        </>
      )}
    </Card>
  )
}

// ─── Card: Cache ───────────────────────────────────────────────────────────────

const CACHE_BAR_TIPS: Record<string, string> = {
  'cache hit':    'Tokens served from prompt cache. They are ~10× cheaper than fresh input. Indicates how much context Claude already "remembered" without reprocessing.',
  'cache create': 'Tokens written to cache for the first time. Paid once and reused in subsequent reads. More expensive than fresh input but amortize over time.',
  'input fresh': 'New context that Claude processed without prior cache — full input price.',
  'output':       'Tokens generated by Claude in responses. They are the most expensive (~3× more than input in Sonnet).',
}

function CacheCard({ cost }: { cost: CostInfo }) {
  const { input_tokens, cache_read, cache_creation, output_tokens } = cost
  const total   = input_tokens + cache_read + cache_creation + output_tokens
  const hitRate = total > 0 ? Math.round((cache_read / (input_tokens + cache_read + cache_creation)) * 100) : 0
  const savings = (cache_read / 1_000_000) * cacheSavingsPerM(cost.model)
  const color   = hitRate >= 70 ? '#3fb950' : hitRate >= 40 ? '#d29922' : '#f85149'

  const bars = [
    { label: 'cache hit',    color: '#3fb95099', tokens: cache_read,    pct: total > 0 ? cache_read / total * 100 : 0 },
    { label: 'cache create', color: '#58a6ff55', tokens: cache_creation, pct: total > 0 ? cache_creation / total * 100 : 0 },
    { label: 'input fresh', color: '#8b949e55', tokens: input_tokens,  pct: total > 0 ? input_tokens / total * 100 : 0 },
    { label: 'output',       color: '#d2992255', tokens: output_tokens, pct: total > 0 ? output_tokens / total * 100 : 0 },
  ].filter(b => b.tokens > 0)

  return (
    <Card>
      <CardHeader icon={Shield} title="Cache efficiency" subtitle="current session" color={color} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {hitRate}%
        </span>
        <div>
          <div style={{ fontSize: 11, color: '#e6edf3' }}>cache hit rate</div>
          {savings > 0.001 && (
            <div style={{ fontSize: 10, color: '#3fb950' }}>~{fmtUsd(savings)} saved</div>
          )}
          <Tip position="bottom" align="left" content={
            <div>
              <div style={{ color: '#58a6ff', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>Why 70%?</div>
              <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                Below 70% cache savings are marginal. In long and continuous sessions hit rate naturally rises. Avoid using /clear in the middle of a session to not lose accumulated cache.
              </div>
            </div>
          }><span style={{ fontSize: 9, color: '#484f58', cursor: 'help', textDecoration: 'underline dotted' }}>target ≥70%</span></Tip>
        </div>
      </div>
      <div style={{ height: 8, background: '#21262d', borderRadius: 4, overflow: 'hidden', display: 'flex', marginBottom: 10 }}>
        {bars.map(b => (
          <div key={b.label} style={{ width: `${b.pct}%`, height: '100%', background: b.color }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
        {bars.map(b => (
          <Tip key={b.label} position="top" align="left" content={
            <div>
              <div style={{ color: b.color.substring(0, 7), fontWeight: 700, fontSize: 11, marginBottom: 3 }}>{b.label}</div>
              <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>{CACHE_BAR_TIPS[b.label] ?? ''}</div>
            </div>
          }>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'help' }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: b.color, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: '#6e7681' }}>{fmtTok(b.tokens)}</span>
              <span style={{ fontSize: 10, color: '#484f58' }}>{b.label}</span>
            </div>
          </Tip>
        ))}
      </div>
    </Card>
  )
}

// ─── Card: Loops ───────────────────────────────────────────────────────────────

function LoopsCard({ cost }: { cost: CostInfo }) {
  const { loops, efficiency_score } = cost
  const totalLoops  = loops?.reduce((s, l) => s + l.count, 0) ?? 0
  const wastedUsd   = (totalLoops * 1_200 / 1_000_000) * PRICE_PER_M.sonnet
  const scoreColor  = efficiency_score >= 90 ? '#3fb950' : efficiency_score >= 70 ? '#d29922' : '#f85149'

  return (
    <Card>
      <CardHeader icon={AlertTriangle} title="Loops and efficiency" subtitle="current session" color={totalLoops > 0 ? '#f85149' : '#3fb950'} />
      <div style={{ display: 'flex', gap: 16, marginBottom: totalLoops > 0 ? 10 : 0 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: totalLoops > 0 ? '#f85149' : '#3fb950', lineHeight: 1 }}>
            {totalLoops}
          </div>
          <div style={{ fontSize: 9, color: '#484f58' }}>loops detected</div>
        </div>
        <Tip position="bottom" align="left" content={
          <div>
            <div style={{ color: scoreColor, fontWeight: 700, fontSize: 11, marginBottom: 3 }}>Efficiency score</div>
            <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
              100 = no loops detected.<br />
              ~5 points deducted for each repeated tool in a block.<br />
              Below 70 indicates inefficient session with wasted tokens.
            </div>
          </div>
        }>
          <div style={{ cursor: 'help' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: scoreColor, lineHeight: 1 }}>
              {efficiency_score}
            </div>
            <div style={{ fontSize: 9, color: '#484f58' }}>efficiency /100</div>
          </div>
        </Tip>
        {totalLoops > 0 && (
          <Tip position="bottom" align="left" content={
            <div>
              <div style={{ color: '#d29922', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>Lost cost estimate</div>
              <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                Calculated as: loops × ~1,200 tokens × blended Sonnet price.<br />
                This is a conservative estimate — actual cost may be higher if loops involve large files.
              </div>
            </div>
          }>
            <div style={{ cursor: 'help' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#d29922', lineHeight: 1 }}>
                ~{fmtUsd(wastedUsd)}
              </div>
              <div style={{ fontSize: 9, color: '#484f58' }}>wasted tokens</div>
            </div>
          </Tip>
        )}
      </div>
      {totalLoops > 0 && loops && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {loops.map((l, i) => (
            <span key={i} style={{ fontSize: 11, color: '#f85149', background: '#f8514914', border: '1px solid #f8514930', borderRadius: 4, padding: '2px 7px' }}>
              {l.toolName} ×{l.count}
            </span>
          ))}
        </div>
      )}
      <div style={{ height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${efficiency_score}%`, height: '100%', background: scoreColor, borderRadius: 2, transition: 'width 0.5s' }} />
      </div>
    </Card>
  )
}

// ─── Card: Distribución de actividad ─────────────────────────────────────────

const CATEGORY_TIPS: Record<string, string> = {
  'Reading':  'Read, Grep, Glob — tools for reading and searching files. High % may indicate excessive exploration before editing.',
  'Editing':  'Edit, Write, NotebookEdit — tools that modify files. This is the real productive work.',
  'Terminal': 'Bash — shell commands executed directly. Many Bash + few Grep may indicate inefficient searches.',
  'Search': 'WebFetch, WebSearch — internet and web page searches.',
  'Agents':  'Agent, Task, SendMessage — sub-agents launched for parallel tasks. They consume their own context quota.',
  'Others':    'Tools that don\'t fit in previous categories (Config, ToolSearch, etc.).',
}

const ACTIVITY_CATEGORIES: { label: string; tools: string[]; color: string }[] = [
  { label: 'Reading',   tools: ['Read', 'Grep', 'Glob'],                        color: '#58a6ff' },
  { label: 'Editing',   tools: ['Edit', 'Write', 'NotebookEdit'],               color: '#3fb950' },
  { label: 'Terminal',  tools: ['Bash'],                                         color: '#d29922' },
  { label: 'Search',  tools: ['WebFetch', 'WebSearch'],                        color: '#bc8cff' },
  { label: 'Agents',   tools: ['Agent', 'Task', 'SendMessage'],                 color: '#f0883e' },
]

function classifyTool(toolName: string): number {
  for (let i = 0; i < ACTIVITY_CATEGORIES.length; i++) {
    if (ACTIVITY_CATEGORIES[i].tools.some(t => toolName.startsWith(t))) return i
  }
  return ACTIVITY_CATEGORIES.length  // "Otros"
}

function ActivityCard({ events, cost }: { events: TraceEvent[]; cost?: CostInfo }) {
  const done = events.filter(e => e.type === 'Done' && e.tool_name)
  if (done.length === 0) return null

  // Contar tool calls por categoría
  const counts = new Array(ACTIVITY_CATEGORIES.length + 1).fill(0)
  for (const e of done) counts[classifyTool(e.tool_name!)]++

  const total = done.length
  const outputTokens = cost?.output_tokens ?? 0

  const rows = [
    ...ACTIVITY_CATEGORIES.map((cat, i) => ({ ...cat, count: counts[i] })),
    { label: 'Others', color: '#484f58', count: counts[ACTIVITY_CATEGORIES.length] },
  ].filter(r => r.count > 0).sort((a, b) => b.count - a.count)

  return (
    <Card>
      <CardHeader icon={Activity} title="Activity distribution" subtitle="current session" />

      {/* Segmented bar */}
      <div style={{ height: 8, background: '#21262d', borderRadius: 4, overflow: 'hidden', display: 'flex', marginBottom: 12 }}>
        {rows.map(r => (
          <div
            key={r.label}
            style={{ width: `${r.count / total * 100}%`, height: '100%', background: r.color }}
          />
        ))}
      </div>

      {/* Rows by category */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(r => {
          const pct      = Math.round(r.count / total * 100)
          const estTok   = outputTokens > 0 ? Math.round(outputTokens * r.count / total) : 0
          return (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: '#8b949e', minWidth: 70 }}>{r.label}</span>
              <div style={{ flex: 1, height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: r.color, opacity: 0.7, borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 10, color: '#6e7681', fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'right' }}>
                {pct}%
              </span>
              <span style={{ fontSize: 10, color: '#484f58', fontVariantNumeric: 'tabular-nums', minWidth: 42, textAlign: 'right' }}>
                {estTok > 0 ? `~${fmtTok(estTok)}` : `${r.count}×`}
              </span>
              <InfoTip position="top" align="right" style={{ flexShrink: 0 }} content={
                <div>
                  <div style={{ color: r.color, fontWeight: 700, fontSize: 11, marginBottom: 3 }}>{r.label}</div>
                  <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>{CATEGORY_TIPS[r.label] ?? ''}</div>
                </div>
              } />
            </div>
          )
        })}
        <div style={{ fontSize: 9, color: '#3d444d', marginTop: 2 }}>
          {total} tool calls · {outputTokens > 0 ? `~${fmtTok(outputTokens)} estimated output tokens` : 'tokens pending from active session'}
        </div>
      </div>
    </Card>
  )
}

// ─── Card: Proyección mensual ──────────────────────────────────────────────────

function ProjectionCard({ quota, cost }: { quota: QuotaData; cost?: CostInfo }) {
  const weeklyTokens    = (quota.weeklyTokensSonnet ?? 0) + (quota.weeklyTokensOpus ?? 0) + (quota.weeklyTokensHaiku ?? 0)
  const weeklyCost      = ((quota.weeklyTokensSonnet ?? 0) / 1_000_000) * PRICE_PER_M.sonnet
    + ((quota.weeklyTokensOpus   ?? 0) / 1_000_000) * PRICE_PER_M.opus
    + ((quota.weeklyTokensHaiku  ?? 0) / 1_000_000) * PRICE_PER_M.haiku
  const monthlyCost     = weeklyCost * 4.3
  const dailyCost       = weeklyCost / 7

  const burnModelPrice = getModelPrice(cost?.model ?? '')
  const burnModelName  = getModelShortName(cost?.model ?? '')
  const burnUsdPerHour = quota.burnRateTokensPerMin > 0
    ? ((quota.burnRateTokensPerMin * 60) / 1_000_000) * burnModelPrice
    : 0

  return (
    <Card>
      <CardHeader icon={TrendingUp} title="Monthly projection" subtitle="based on this week" />
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 10 }}>
        <Tip position="top" align="left" content={
          <div>
            <div style={{ color: '#58a6ff', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>Monthly projection</div>
            <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
              Weekly consumption × 4.3 (weeks/month).<br />
              Assumes upcoming weeks will have the same pace.<br />
              Based on actual Sonnet, Opus, and Haiku tokens with blended prices.
            </div>
          </div>
        }>
          <div style={{ cursor: 'help' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#e6edf3', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {weeklyCost > 0 ? `~${fmtUsd(monthlyCost)}` : '—'}
            </div>
            <div style={{ fontSize: 9, color: '#484f58' }}>/month · {weeklyCost > 0 ? `${fmtUsd(weeklyCost)}/week · ${fmtUsd(dailyCost)}/day` : 'no data'}</div>
          </div>
        </Tip>
        {burnUsdPerHour > 0 && (
          <Tip position="top" align="left" content={
            <div>
              <div style={{ color: '#d29922', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>Cost per hour (now)</div>
              <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                Calculated with active model ({burnModelName}) at blended price.<br />
                {quota.burnRateTokensPerMin.toLocaleString()} tok/min × 60 ÷ 1M × price/M
              </div>
            </div>
          }>
            <div style={{ cursor: 'help' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#d29922', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                ~{fmtUsd(burnUsdPerHour)}/h
              </div>
              <div style={{ fontSize: 9, color: '#484f58' }}>now · {quota.burnRateTokensPerMin.toLocaleString()} tok/min</div>
            </div>
          </Tip>
        )}
      </div>
      {weeklyTokens > 0 && (
        <div style={{ fontSize: 10, color: '#484f58' }}>
          {fmtTok(weeklyTokens)} tokens this week · estimated blended input/output prices
        </div>
      )}
    </Card>
  )
}

// ─── Panel: Coach en tiempo real ───────────────────────────────────────────────

const TIP_STYLE: Record<TipLevel, { color: string; bg: string; border: string; Icon: React.ElementType }> = {
  error:   { color: '#f85149', bg: '#3d1717', border: '#f8514940', Icon: XCircle },
  warning: { color: '#d29922', bg: '#2d2008', border: '#d2992240', Icon: TriangleAlert },
  info:    { color: '#58a6ff', bg: '#0d1e33', border: '#58a6ff30', Icon: Info },
  success: { color: '#3fb950', bg: '#0d1f10', border: '#3fb95030', Icon: CheckCircle2 },
}

function CoachPanel({ tips }: { tips: CoachTip[] }) {
  if (tips.length === 0) {
    return (
      <Card>
        <CardHeader icon={Lightbulb} title="Real-time optimizer" color="#d29922" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#484f58', fontSize: 12 }}>
          <CheckCircle2 size={14} color="#3fb950" />
          Clean session — no optimization suggestions at this time
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader icon={Lightbulb} title="Real-time optimizer" subtitle={`${tips.length} suggestion${tips.length > 1 ? 's' : ''}`} color="#d29922" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tips.map((tip, i) => {
          const s = TIP_STYLE[tip.level]
          return (
            <div key={i} style={{
              background: s.bg, border: `1px solid ${s.border}`,
              borderLeft: `3px solid ${s.color}`,
              borderRadius: 6, padding: '8px 10px',
            }}>
              {/* Header: icono + título */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <s.Icon size={13} color={s.color} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: s.color, marginBottom: 3 }}>{tip.title}</div>
                  <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.5 }}>{tip.text}</div>
                </div>
              </div>

              {/* Prompt that caused it */}
              {tip.prompt && (
                <div style={{
                  marginTop: 8, padding: '6px 10px',
                  background: '#0d1117', border: '1px solid #30363d',
                  borderRadius: 5,
                }}>
                  <div style={{ fontSize: 9, color: '#484f58', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
                    Prompt that caused it — Block #{tip.blockIndex}
                  </div>
                  <div style={{
                    fontSize: 11, color: '#7d8590', fontStyle: 'italic',
                    lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: 80, overflow: 'hidden',
                    WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
                  }}>
                    "{tip.prompt}"
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ─── Main component ───────────────────────────────────────────────────────

export function UsageView({ quota, cost, events, prompts, claudeStats }: Props) {
  if (!quota) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#484f58', fontSize: 13 }}>
        Loading usage data…
      </div>
    )
  }

  const tips = generateTips(cost, quota, events, prompts)

  return (
    <div style={{ padding: '16px 20px' }}>

      {/* 2 column grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: 'auto',
        gap: 12,
        maxWidth: 1200,
        margin: '0 auto',
      }}>

        {/* Row 1: Current status (full width) — context + quota + reset */}
        <div style={{ gridColumn: '1 / -1' }}>
          <StatusCard quota={quota} cost={cost} />
        </div>

        {/* Row 2: Today's activity (full width) — stats-cache.json */}
        {claudeStats && (
          <div style={{ gridColumn: '1 / -1' }}>
            <DailyActivityCard stats={claudeStats} />
          </div>
        )}

        {/* Row 3: Coach (full width) */}
        <div style={{ gridColumn: '1 / -1' }}>
          <CoachPanel tips={tips} />
        </div>

        {/* Row 4: Activity | Cache */}
        {events && events.length > 0
          ? <ActivityCard events={events} cost={cost} />
          : <div />
        }
        {cost ? <CacheCard cost={cost} /> : (
          <Card>
            <CardHeader icon={Shield} title="Cache efficiency" />
            <span style={{ fontSize: 12, color: '#484f58' }}>No active session data</span>
          </Card>
        )}

        {/* Row 5: Models | Loops */}
        <ModelCard quota={quota} />
        {cost ? <LoopsCard cost={cost} /> : (
          <Card>
            <CardHeader icon={AlertTriangle} title="Loops and efficiency" />
            <span style={{ fontSize: 12, color: '#484f58' }}>No active session data</span>
          </Card>
        )}

        {/* Row 6: Projection (full width) */}
        <div style={{ gridColumn: '1 / -1' }}>
          <ProjectionCard quota={quota} cost={cost} />
        </div>

      </div>
    </div>
  )
}

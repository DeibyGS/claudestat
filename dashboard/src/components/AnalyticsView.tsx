import { useEffect, useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import {
  TrendingUp, DollarSign, Repeat2, Zap, Activity, Clock, FolderGit2,
  FileText, ChevronDown, ChevronUp, X,
} from 'lucide-react'
import { Tip } from './Tip'
import type { QuotaData, CostInfo, TraceEvent, ClaudeStatsData } from '../types'
import { UsageView } from './UsageView'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayData {
  date: string; sessions: number; cost: number
  input_tokens: number; output_tokens: number; cache_read: number
  loops: number; avg_efficiency: number
}
interface ModelRow   { date: string; model: string; tokens: number; cost: number }
interface ProjectHour { project: string; sessions: number; hours: number; cost: number }
interface Kpis {
  week_cost: number; month_cost: number
  week_sessions: number; month_sessions: number
  week_loops: number; avg_efficiency: number
}
interface ReportMeta { id: number; date: string; preview: string; created_at: string }
interface ReportFull extends ReportMeta { report_markdown: string }

interface Props {
  quota?:       QuotaData
  cost?:        CostInfo
  events?:      TraceEvent[]
  prompts?:     Array<{ index: number; ts: number; text: string }>
  claudeStats?: ClaudeStatsData
}

type Period = '7' | '30' | '90'
const PERIOD_LABELS: Record<Period, string> = { '7': '7 days', '30': '30 days', '90': '90 days' }
const MODEL_COLORS: Record<string, string>  = { haiku: '#3fb950', sonnet: '#58a6ff', opus: '#d29922' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function modelKey(m: string) {
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('opus'))  return 'opus'
  return 'sonnet'
}
function fmtCost(v: number)  { return v >= 10 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}` }
function fmtTok(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) {
    const k = Math.round(n / 1_000)
    return k >= 1000 ? `${(k / 1000).toFixed(1)}M` : `${k}K`
  }
  return String(n)
}
function fmtHours(h: number) { return h < 1 ? `${Math.round(h * 60)}m` : `${h.toFixed(1)}h` }
function projectName(p: string) {
  if (p === 'No project') return p
  return p.split('/').filter(Boolean).pop() ?? p
}

function pivotByModel(rows: ModelRow[]): Array<Record<string, string | number>> {
  const map = new Map<string, Record<string, string | number>>()
  for (const r of rows) {
    const key = modelKey(r.model)
    const cur = map.get(r.date) ?? { date: r.date, haiku: 0, sonnet: 0, opus: 0 }
    cur[key] = (cur[key] as number) + r.tokens
    map.set(r.date, cur)
  }
  return [...map.values()]
}

const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#6e7681',
  marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.05em',
}

const tooltipStyle = {
  contentStyle: { background: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: 11 },
  labelStyle:   { color: '#e6edf3', fontWeight: 600 },
  itemStyle:    { color: '#8b949e' },
}

// ── KpiCard ───────────────────────────────────────────────────────────────────

interface KpiCardProps { icon: React.ReactNode; label: string; value: string; sub?: string; color?: string; tip: string }
function KpiCard({ icon, label, value, sub, color = '#58a6ff', tip }: KpiCardProps) {
  return (
    <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '14px 16px', flex: 1, minWidth: 140 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ color, opacity: 0.8 }}>{icon}</span>
        <Tip content={tip} position="bottom" align="left">
          <span style={{ fontSize: 10, color: '#6e7681', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'default', borderBottom: '1px dotted #484f58' }}>
            {label}
          </span>
        </Tip>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#e6edf3', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#484f58', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ── MarkdownView ──────────────────────────────────────────────────────────────

function MarkdownView({ content }: { content: string }) {
  return (
    <div style={{ fontFamily: 'inherit', lineHeight: 1.7, color: '#c9d1d9' }}>
      {content.split('\n').map((line, i) => {
        if (line.startsWith('# '))   return <h1 key={i} style={{ fontSize: 18, fontWeight: 700, color: '#e6edf3', margin: '20px 0 8px', borderBottom: '1px solid #21262d', paddingBottom: 6 }}>{line.slice(2)}</h1>
        if (line.startsWith('## '))  return <h2 key={i} style={{ fontSize: 15, fontWeight: 600, color: '#e6edf3', margin: '16px 0 6px' }}>{line.slice(3)}</h2>
        if (line.startsWith('### ')) return <h3 key={i} style={{ fontSize: 13, fontWeight: 600, color: '#8b949e', margin: '12px 0 4px' }}>{line.slice(4)}</h3>
        if (line.startsWith('- [x] ')) return <div key={i} style={{ display: 'flex', gap: 8, margin: '3px 0', color: '#3fb950', fontSize: 12 }}>✅ <span style={{ textDecoration: 'line-through', color: '#6e7681' }}>{line.slice(6)}</span></div>
        if (line.startsWith('- [ ] ')) return <div key={i} style={{ display: 'flex', gap: 8, margin: '3px 0', fontSize: 12 }}>⬜ <span>{line.slice(6)}</span></div>
        if (line.startsWith('- '))   return <div key={i} style={{ margin: '3px 0', paddingLeft: 16, fontSize: 12 }}>· {line.slice(2)}</div>
        if (line.startsWith('> '))   return <blockquote key={i} style={{ margin: '8px 0', paddingLeft: 12, borderLeft: '3px solid #30363d', color: '#8b949e', fontSize: 12 }}>{line.slice(2)}</blockquote>
        if (line.startsWith('---'))  return <hr key={i} style={{ border: 'none', borderTop: '1px solid #21262d', margin: '14px 0' }} />
        if (line.trim() === '')      return <div key={i} style={{ height: 6 }} />
        return <p key={i} style={{ margin: '3px 0', fontSize: 12 }}>{line}</p>
      })}
    </div>
  )
}

// ── ReportsPanel ──────────────────────────────────────────────────────────────

function ReportsPanel() {
  const [reports,    setReports]    = useState<ReportMeta[]>([])
  const [expanded,   setExpanded]   = useState(false)
  const [selected,   setSelected]   = useState<ReportFull | null>(null)
  const [generating, setGenerating] = useState(false)
  const [importing,  setImporting]  = useState(false)
  const [msg,        setMsg]        = useState<string | null>(null)

  function fetchReports() {
    fetch('/api/weekly-reports').then(r => r.json()).then(setReports).catch(() => {})
  }
  useEffect(() => { fetchReports() }, [])

  async function handleGenerate() {
    setGenerating(true); setMsg(null)
    try {
      const d = await fetch('/api/weekly-reports/generate-now', { method: 'POST' }).then(r => r.json())
      setMsg(d.skipped ? `Ya existe: ${d.date}` : `Generado: ${d.date}`)
      if (!d.skipped) fetchReports()
    } catch { setMsg('Error generating') }
    setGenerating(false)
  }

  async function handleImport() {
    setImporting(true); setMsg(null)
    try {
      const d = await fetch('/api/weekly-reports/import-local', { method: 'POST' }).then(r => r.json())
      setMsg(`${d.imported} imported, ${d.skipped} already existed`)
      if (d.imported > 0) fetchReports()
    } catch { setMsg('Error importing') }
    setImporting(false)
  }

  async function handleSelect(date: string) {
    const r = await fetch(`/api/weekly-reports/${date}`)
    if (r.ok) { setSelected(await r.json()); setExpanded(false) }
  }

  const btnStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
    cursor: 'pointer', border: '1px solid #30363d',
    background: 'none', color: '#8b949e',
    transition: 'color 0.15s, border-color 0.15s',
  }

  return (
    <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, marginBottom: 0 }}>
      {/* Strip header */}
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <FileText size={12} color="#6e7681" />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#8b949e' }}>Weekly reports</span>
        {msg && <span style={{ fontSize: 11, color: '#3fb950' }}>{msg}</span>}
        <div style={{ flex: 1 }} />
        <button
          style={{ ...btnStyle, color: generating ? '#484f58' : '#58a6ff', borderColor: generating ? '#30363d' : '#58a6ff30' }}
          onClick={handleGenerate} disabled={generating}
        >
          <Zap size={11} />{generating ? 'Generating…' : 'Generate'}
        </button>
        <button style={btnStyle} onClick={handleImport} disabled={importing}>
          {importing ? 'Importing…' : 'Import'}
        </button>
        <button
          style={{ ...btnStyle, color: expanded ? '#e6edf3' : '#6e7681', borderColor: expanded ? '#30363d' : '#21262d' }}
          onClick={() => setExpanded(v => !v)}
        >
          {reports.length} reports
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>

      {/* Collapsible list */}
      {expanded && (
        <div style={{ borderTop: '1px solid #21262d', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
          {reports.length === 0
            ? <span style={{ fontSize: 11, color: '#484f58', padding: '4px 4px' }}>No reports — use "Generate" to create one</span>
            : reports.map(r => (
                <button
                  key={r.id} onClick={() => handleSelect(r.date)}
                  style={{ background: 'none', border: '1px solid #21262d', borderRadius: 5, padding: '7px 10px', cursor: 'pointer', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center', color: 'inherit', transition: 'background 0.1s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#21262d' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
                >
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#58a6ff', minWidth: 90, flexShrink: 0 }}>{r.date}</span>
                  <span style={{ fontSize: 11, color: '#6e7681', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.preview}
                  </span>
                </button>
              ))
          }
        </div>
      )}

      {/* Modal */}
      {selected && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setSelected(null)}
        >
          <div
            style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, width: '80%', maxWidth: 820, maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px #00000088' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={13} color="#58a6ff" />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3' }}>Informe semanal — {selected.date}</span>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6e7681', padding: 4 }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
              <MarkdownView content={selected.report_markdown} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export function AnalyticsView({ quota, cost, events, prompts, claudeStats }: Props) {
  const [period,        setPeriod]        = useState<Period>('30')
  const [projectPeriod, setProjectPeriod] = useState<Period>('30')
  const [daily,         setDaily]         = useState<DayData[]>([])
  const [byModel,       setByModel]       = useState<ModelRow[]>([])
  const [projectHours,  setProjectHours]  = useState<ProjectHour[]>([])
  const [kpis,          setKpis]          = useState<Kpis | null>(null)
  const [loading,       setLoading]       = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/analytics?days=${period}&project_days=${projectPeriod}`)
      .then(r => r.json())
      .then(d => {
        setDaily(d.daily ?? [])
        setByModel(d.by_model ?? [])
        setProjectHours(d.project_hours ?? [])
        setKpis(d.kpis ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [period, projectPeriod])

  const modelPivot  = pivotByModel(byModel)
  const totalInput  = daily.reduce((a, d) => a + d.input_tokens, 0)
  const totalOutput = daily.reduce((a, d) => a + d.output_tokens, 0)
  const totalCache  = daily.reduce((a, d) => a + d.cache_read, 0)
  const totalTok    = totalInput + totalOutput + totalCache
  const cacheRatio  = totalInput + totalCache > 0 ? Math.round(totalCache / (totalInput + totalCache) * 100) : 0
  const totalHours  = projectHours.reduce((a, p) => a + p.hours, 0)
  const tokensDaily = daily.map(d => ({
    date:    d.date,
    tokens:  d.input_tokens + d.output_tokens + d.cache_read,
    sessions: d.sessions,
  }))

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#0d1117' }}>

      {/* Reports panel */}
      <div style={{ padding: '16px 20px 12px' }}>
        <ReportsPanel />
      </div>

      {/* En tiempo real — section label */}
      <div style={{ padding: '0 20px 2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Real time
          </span>
          <div style={{ flex: 1, height: 1, background: '#21262d' }} />
        </div>
      </div>

      {/* UsageView content (sin scroll propio) */}
      <UsageView quota={quota} cost={cost} events={events} prompts={prompts} claudeStats={claudeStats} />

      {/* Análisis histórico — section label + period selector */}
      <div style={{ padding: '0 20px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0 16px', borderTop: '1px solid #21262d' }}>
          <TrendingUp size={12} color="#484f58" />
          <span style={{ fontSize: 10, fontWeight: 600, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Historical analysis
          </span>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {(['7', '30', '90'] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{
                padding: '3px 9px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                background: period === p ? '#1f6feb' : 'none',
                border: `1px solid ${period === p ? '#1f6feb' : '#30363d'}`,
                color: period === p ? '#fff' : '#8b949e',
                transition: 'all 0.15s',
              }}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {loading && <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>Loading…</div>}

        {!loading && kpis && (
          <>
            {/* KPI cards */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
              <KpiCard
                icon={<DollarSign size={13} />} label="Real spend 7d"
                value={fmtCost(kpis.week_cost)} sub={`${kpis.week_sessions} sessions · DB`}
                color="#58a6ff"
                tip="Real spend in the last 7 days from the claudestat database. Complements the projection above that uses stats-cache."
              />
              <KpiCard
                icon={<DollarSign size={13} />} label="Real spend 30d"
                value={fmtCost(kpis.month_cost)} sub={`${kpis.month_sessions} sessions`}
                color="#a371f7"
                tip="Real spend in the last 30 days recorded in the claudestat database."
              />
              <KpiCard
                icon={<Activity size={13} />} label={`Tokens ${PERIOD_LABELS[period]}`}
                value={fmtTok(totalTok)} sub={`In+Out: ${fmtTok(totalInput + totalOutput)}`}
                color="#d29922"
                tip="Total tokens for the period (input + output + cache read). Cache is ~10× cheaper than fresh tokens."
              />
              <KpiCard
                icon={<Clock size={13} />} label={`Hours ${PERIOD_LABELS[period]}`}
                value={fmtHours(totalHours)} sub={`${projectHours.length} projects`}
                color="#3fb950"
                tip="Total estimated work time in Claude Code (sum of durations of all sessions in the period)."
              />
              <KpiCard
                icon={<Repeat2 size={13} />} label="Loops 7d"
                value={String(kpis.week_loops)} sub={kpis.week_loops > 20 ? 'High — review' : 'Normal'}
                color={kpis.week_loops > 20 ? '#f85149' : '#3fb950'}
                tip="Loops detected in the last week (same tool repeated ≥4 times without progress). Each loop wastes tokens and cost."
              />
              <KpiCard
                icon={<Zap size={13} />} label="Avg efficiency"
                value={`${kpis.avg_efficiency}%`} sub={`Cache: ${cacheRatio}%`}
                color={kpis.avg_efficiency >= 80 ? '#3fb950' : kpis.avg_efficiency >= 60 ? '#d29922' : '#f85149'}
                tip={`Average efficiency for the period (100% = no loops or redundancy). Cache: ${cacheRatio}% of tokens come from cache (cheaper).`}
              />
            </div>

            {/* Costo diario */}
            <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '16px 20px', marginBottom: 14 }}>
              <div style={sectionTitle}>Daily cost (USD)</div>
              <ResponsiveContainer width="100%" height={130}>
                <LineChart data={daily} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#6e7681' }} tickFormatter={v => v.slice(5)} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: '#6e7681' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(1)}`} />
                  <Tooltip {...tooltipStyle} cursor={{ stroke: '#30363d' }} formatter={(v: number) => [fmtCost(v), 'Cost']} />
                  <Line type="monotone" dataKey="cost" stroke="#58a6ff" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Tokens por día (fluctuación) + Tokens por modelo */}
            <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
              <div style={{ flex: 1, background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '16px 20px' }}>
                <div style={sectionTitle}>Tokens per day · fluctuation</div>
                <ResponsiveContainer width="100%" height={130}>
                  <ComposedChart data={tokensDaily} margin={{ top: 4, right: 14, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#6e7681' }} tickFormatter={v => v.slice(5)} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis yAxisId="left"  tick={{ fontSize: 9, fill: '#6e7681' }} axisLine={false} tickLine={false} tickFormatter={fmtTok} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#6e7681' }} axisLine={false} tickLine={false} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: '#21262d' }} formatter={(v: number, name: string) => [name === 'Tokens' ? fmtTok(v) : v, name]} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10, color: '#8b949e' }} />
                    <Bar  yAxisId="left"  dataKey="tokens"   name="Tokens"   fill="#1f6feb88" radius={[2, 2, 0, 0]} />
                    <Line yAxisId="right" dataKey="sessions" name="Sessions" stroke="#3fb950" dot={false} strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div style={{ flex: 1, background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '16px 20px' }}>
                <div style={sectionTitle}>Tokens by model (daily)</div>
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={modelPivot} barSize={6} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#6e7681' }} tickFormatter={v => String(v).slice(5)} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 9, fill: '#6e7681' }} axisLine={false} tickLine={false} tickFormatter={v => fmtTok(v)} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: '#21262d' }} formatter={(v: number) => [fmtTok(v)]} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10, color: '#8b949e' }} />
                    <Bar dataKey="sonnet" name="Sonnet" fill={MODEL_COLORS.sonnet} stackId="a" />
                    <Bar dataKey="haiku"  name="Haiku"  fill={MODEL_COLORS.haiku}  stackId="a" />
                    <Bar dataKey="opus"   name="Opus"   fill={MODEL_COLORS.opus}   stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Horas por proyecto */}
            {projectHours.length > 0 && (
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                  <FolderGit2 size={11} color="#6e7681" />
                  <Tip content="Only includes sessions tracked by claudestat (since install). Full project history available in the Projects tab.">
                    <span style={sectionTitle}>Hours by project ⓘ</span>
                  </Tip>
                  <div style={{ flex: 1 }} />
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['7', '30', '90'] as Period[]).map(p => (
                      <button key={p} onClick={() => setProjectPeriod(p)} style={{
                        padding: '2px 7px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                        background: projectPeriod === p ? '#1f6feb' : 'none',
                        border: `1px solid ${projectPeriod === p ? '#1f6feb' : '#30363d'}`,
                        color: projectPeriod === p ? '#fff' : '#8b949e',
                        transition: 'all 0.15s',
                      }}>
                        {PERIOD_LABELS[p]}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {projectHours.map(p => {
                    const pct = totalHours > 0 ? (p.hours / totalHours) * 100 : 0
                    return (
                      <div key={p.project}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: '#c9d1d9', fontWeight: 500 }}>{projectName(p.project)}</span>
                          <div style={{ display: 'flex', gap: 12 }}>
                            <span style={{ fontSize: 10, color: '#6e7681' }}>{p.sessions} sessions</span>
                            <span style={{ fontSize: 10, color: '#d29922', minWidth: 40, textAlign: 'right' }}>{fmtCost(p.cost)}</span>
                            <span style={{ fontSize: 11, color: '#e6edf3', fontWeight: 600, minWidth: 36, textAlign: 'right' }}>{fmtHours(p.hours)}</span>
                          </div>
                        </div>
                        <div style={{ height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: '#58a6ff', borderRadius: 2, transition: 'width 0.3s' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {!loading && daily.length === 0 && (
          <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: '40px 0' }}>
            No data for the selected period
          </div>
        )}
      </div>
    </div>
  )
}

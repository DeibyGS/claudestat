import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import {
  Workflow, CheckCircle2, XCircle, AlertTriangle, Cpu, Bot,
  X as XIcon, FileCode2, Sparkles, GitCommit, StopCircle, MessageSquare,
  Download, TrendingUp, TrendingDown, Minus, Clock, DollarSign,
  Terminal, FileText, SearchCode, FileEdit, Braces,
  Layers, HelpCircle, RepeatIcon, Table2, LineChart,
} from 'lucide-react'
import { LineChart as RechartLine, Line, XAxis, YAxis, Tooltip as RechartTooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import type { OrchTimeline, OrchCycle, OrchCycleTrace, OrchRunSummary, OrchAggregates, GanttBar, SessionTableRow, CycleToolTrend, DiffResult, CycleDiff, CommandLogEntry, FileChangeEntry, OrchEvent } from '../types'

const CC_COLOR  = '#58a6ff'
const OC_COLOR  = '#3fb950'
const ERR_COLOR = '#f85149'
const WARN_COLOR = '#d29922'
const DIM_COLOR  = '#484f58'
const BG_DARK   = '#0d1117'
const BG_CARD   = '#161b22'
const BORDER    = '#21262d'

const STATUS_COLORS: Record<string, string> = {
  success: OC_COLOR, verify_failed: WARN_COLOR, active: CC_COLOR, error: ERR_COLOR, paused: WARN_COLOR,
}

const TOOL_ICONS: Record<string, typeof Terminal> = {
  Read: FileText, Edit: FileEdit, Bash: Terminal, Glob: SearchCode, Grep: SearchCode,
  Write: FileCode2, Skill: Sparkles, Question: HelpCircle,
}

function fmtTokens(n: number | null): string {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtModel(m: string | null): string {
  if (!m) return ''
  const name = m.split('/').pop() ?? m
  return name.replace(/^claude-|-\d{8}$|-latest$/g, '')
}

function fmtDuration(secs: number | null): string {
  if (secs === null || secs === 0) return '—'
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function fmtElapsed(startedAt: string | null): string {
  if (!startedAt) return ''
  const ms = Date.now() - new Date(startedAt).getTime()
  if (ms < 60_000) return 'just now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}

function TrendArrow({ current, historical }: { current: number; historical: number }) {
  if (historical <= 0) return null
  const ratio = current / historical
  if (ratio > 1.05) return <TrendingUp size={10} color={ERR_COLOR} style={{ flexShrink: 0 }} />
  if (ratio < 0.95) return <TrendingDown size={10} color={OC_COLOR} style={{ flexShrink: 0 }} />
  return <Minus size={10} color={DIM_COLOR} style={{ flexShrink: 0 }} />
}

function StatusBadge({ status }: { status: OrchTimeline['status'] }) {
  const config: Record<string, { label: string; color: string; bg: string }> = {
    active:   { label: 'ACTIVE',   color: OC_COLOR,  bg: '#3fb95022' },
    paused:   { label: 'PAUSED',   color: WARN_COLOR, bg: '#d2992222' },
    complete: { label: 'DONE',     color: CC_COLOR,  bg: '#58a6ff22' },
    none:     { label: 'IDLE',     color: DIM_COLOR,  bg: '#484f5822' },
  }
  const c = config[status] ?? config.none
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 10, background: c.bg, color: c.color }}>
      {c.label}
    </span>
  )
}

function cycleStatusColor(cycle: OrchCycle): string {
  if (cycle.status === 'error') return ERR_COLOR
  if (cycle.status === 'verify_failed') return WARN_COLOR
  if (cycle.verified === true) return OC_COLOR
  if (cycle.status === 'active') return CC_COLOR
  return DIM_COLOR
}

function VerificationRow({ label, passed, errors }: { label: string; passed: boolean | null; errors?: string[] }) {
  if (passed === null) return <span style={{ color: DIM_COLOR }}>{label} —</span>
  if (passed) return <span style={{ color: OC_COLOR, fontWeight: 600 }}><CheckCircle2 size={8} style={{ display: 'inline' }} /> {label}</span>
  const first = errors?.[0]
  return (
    <span title={errors?.join('\n')} style={{ color: ERR_COLOR, fontWeight: 600, cursor: 'help' }}>
      <XCircle size={8} style={{ display: 'inline' }} /> {label}
      {first && <span style={{ fontFamily: 'monospace', opacity: 0.75, marginLeft: 4, fontWeight: 400 }}>
        {first.length > 50 ? first.slice(0, 50) + '…' : first}
      </span>}
    </span>
  )
}

function CostDonut({ ccCost, ocCost }: { ccCost: number; ocCost: number }) {
  const total = ccCost + ocCost
  if (total === 0) return null
  const ccPct = (ccCost / total) * 100
  const ocPct = (ocCost / total) * 100
  const R = 22, CX = 26, CY = 26, SIZE = 52
  const circ = 2 * Math.PI * R

  const ccDash = (ccCost / total) * circ
  const ocDash = (ocCost / total) * circ

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        <circle cx={CX} cy={CY} r={R} fill="none" stroke={BORDER} strokeWidth={6} />
        {ccCost > 0 && <circle cx={CX} cy={CY} r={R} fill="none" stroke={CC_COLOR} strokeWidth={6}
          strokeDasharray={`${ccDash} ${circ}`} />}
        {ocCost > 0 && <circle cx={CX} cy={CY} r={R} fill="none" stroke={OC_COLOR} strokeWidth={6}
          strokeDasharray={`${ocDash} ${circ}`} strokeDashoffset={-ccDash} />}
      </svg>
      <div>
        <div style={{ fontSize: 9, color: CC_COLOR, fontWeight: 700 }}>CC ${ccCost.toFixed(2)} ({ccPct.toFixed(0)}%)</div>
        <div style={{ fontSize: 9, color: OC_COLOR, fontWeight: 700 }}>OC ${ocCost.toFixed(2)} ({ocPct.toFixed(0)}%)</div>
        <div style={{ fontSize: 9, color: '#c9d1d9', fontWeight: 700, marginTop: 1 }}>Total ${total.toFixed(2)}</div>
      </div>
    </div>
  )
}

function TokenRow({ label, inToks, outToks, cacheToks, color, estimated }: { label: string; inToks: number | null; outToks: number | null; cacheToks: number | null; color: string; estimated?: boolean }) {
  const total = (inToks ?? 0) + (outToks ?? 0) + (cacheToks ?? 0)
  const max = Math.max(inToks ?? 0, outToks ?? 0, cacheToks ?? 0, 1)
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}
        {estimated && <span style={{ fontSize: 7, color: '#d29922', fontWeight: 400, fontFamily: 'monospace' }}>~estimated</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {inToks !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8 }}>
            <span style={{ color: DIM_COLOR, minWidth: 28 }}>IN</span>
            <div style={{ flex: 1, height: 8, background: BORDER, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${((inToks ?? 0) / max) * 100}%`, height: '100%', background: color, borderRadius: 4, minWidth: 2, opacity: 0.7 }} />
            </div>
            <span style={{ fontFamily: 'monospace', color: '#c9d1d9', minWidth: 50, textAlign: 'right' }}>{fmtTokens(inToks)}</span>
          </div>
        )}
        {outToks !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8 }}>
            <span style={{ color: DIM_COLOR, minWidth: 28 }}>OUT</span>
            <div style={{ flex: 1, height: 8, background: BORDER, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${((outToks ?? 0) / max) * 100}%`, height: '100%', background: color, borderRadius: 4, minWidth: 2, opacity: 0.7 }} />
            </div>
            <span style={{ fontFamily: 'monospace', color: '#c9d1d9', minWidth: 50, textAlign: 'right' }}>{fmtTokens(outToks)}</span>
          </div>
        )}
        {cacheToks !== null && cacheToks > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8 }}>
            <span style={{ color: DIM_COLOR, minWidth: 28 }}>CACHE</span>
            <div style={{ flex: 1, height: 8, background: BORDER, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${((cacheToks ?? 0) / max) * 100}%`, height: '100%', background: '#a371f7', borderRadius: 4, minWidth: 2, opacity: 0.7 }} />
            </div>
            <span style={{ fontFamily: 'monospace', color: '#c9d1d9', minWidth: 50, textAlign: 'right' }}>{fmtTokens(cacheToks)}</span>
          </div>
        )}
      </div>
      <div style={{ fontSize: 8, color: DIM_COLOR, fontFamily: 'monospace', marginTop: 2 }}>
        Total {fmtTokens(total)} tokens
      </div>
    </div>
  )
}

function ToolCountChart({ counts, color }: { counts: Record<string, number> | null; color: string }) {
  if (!counts) return <div style={{ fontSize: 8, color: DIM_COLOR }}>No tool data</div>
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return <div style={{ fontSize: 8, color: DIM_COLOR }}>No tools used</div>
  const maxVal = Math.max(...entries.map(e => e[1]), 1)
  const total = entries.reduce((s, e) => s + e[1], 0)
  return (
    <div>
      {entries.slice(0, 6).map(([name, count]) => {
        const Icon = TOOL_ICONS[name] ?? Layers
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
            <Icon size={8} color={DIM_COLOR} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 8, color: '#8b949e', minWidth: 32 }}>{name}</span>
            <div style={{ flex: 1, height: 10, background: BORDER, borderRadius: 5, overflow: 'hidden' }}>
              <div style={{
                width: `${(count / maxVal) * 100}%`, height: '100%', background: color, borderRadius: 5,
                minWidth: count > 0 ? 2 : 0, transition: 'width 0.3s ease',
              }} />
            </div>
            <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#c9d1d9', minWidth: 24, textAlign: 'right' }}>{count}</span>
            <span style={{ fontSize: 7, color: DIM_COLOR, minWidth: 28, textAlign: 'right' }}>({((count / total) * 100).toFixed(0)}%)</span>
          </div>
        )
      })}
      {entries.length > 6 && <div style={{ fontSize: 7, color: DIM_COLOR, padding: '2px 0' }}>+{entries.length - 6} more tools</div>}
    </div>
  )
}

function EventTimeline({ events, max }: { events: OrchCycle['cc_events']; max?: number }) {
  if (events.length === 0) return <div style={{ fontSize: 8, color: DIM_COLOR }}>No events recorded</div>
  const display = max ? events.slice(-max) : events
  const hasMore = max ? events.length > max : false
  return (
    <div>
      {display.map((ev, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'flex-start', gap: 4, padding: '3px 0',
          borderTop: i > 0 ? `1px solid ${BORDER}` : 'none', fontSize: 8,
          color: ev.action === 'error' ? ERR_COLOR : '#c9d1d9',
        }}>
          <span style={{
            flexShrink: 0, width: 8, height: 8, borderRadius: '50%', marginTop: 2,
            background: ev.action === 'error' ? ERR_COLOR
              : ev.action === 'done' ? OC_COLOR
              : ev.action === 'planning' ? '#a371f7'
              : DIM_COLOR,
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: ev.action === 'error' ? ERR_COLOR : '#c9d1d9', fontWeight: ev.action === 'error' ? 700 : 400 }}>
              {ev.description}
            </div>
            <div style={{ color: DIM_COLOR, fontFamily: 'monospace', fontSize: 7 }}>
              {ev.ts?.slice(0, 8) ?? ''}
              {ev.duration_secs !== null && ` · ${fmtDuration(ev.duration_secs)}`}
              {ev.retry_count !== null && ev.retry_count > 0 && ` · retry ${ev.retry_count}`}
              {ev.phase && ` · ${ev.phase}`}
            </div>
          </div>
        </div>
      ))}
      {hasMore && max && <div style={{ fontSize: 7, color: DIM_COLOR, padding: '2px 0' }}>+{events.length - max} earlier events</div>}
    </div>
  )
}

function FilesChanged({ files }: { files: string[] }) {
  if (!files || files.length === 0) return null
  const byDir: Record<string, string[]> = {}
  for (const f of files) {
    const parts = f.split('/')
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '/'
    const file = parts[parts.length - 1]
    if (!byDir[dir]) byDir[dir] = []
    byDir[dir].push(file)
  }
  return (
    <div>
      {Object.entries(byDir).map(([dir, fls]) => (
        <div key={dir} style={{ marginBottom: 2 }}>
          <div style={{ fontSize: 7, color: DIM_COLOR, fontFamily: 'monospace' }}>{dir}/</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, paddingLeft: 8, marginTop: 1 }}>
            {fls.map((f, i) => (
              <span key={i} style={{
                fontSize: 8, padding: '1px 5px', borderRadius: 3, background: '#58a6ff15', color: '#58a6ff',
                fontFamily: 'monospace', border: '1px solid #58a6ff22',
              }}>{f}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function PhaseSummaryCard({ cycle }: { cycle: OrchCycle }) {
  const trace = cycle.trace
  const ccCost = cycle.cc_cost ?? 0
  const ocCost = cycle.oc_cost ?? 0
  const totalCost = ccCost + ocCost
  const ccPct = totalCost > 0 ? Math.round((ccCost / totalCost) * 100) : 0
  const ocPct = totalCost > 0 ? Math.round((ocCost / totalCost) * 100) : 0
  const ccTotalToks = (cycle.cc_input_tokens ?? 0) + (cycle.cc_output_tokens ?? 0) + (cycle.cc_cache_tokens ?? 0)
  const ocTotalToks = (cycle.oc_input_tokens ?? 0) + (cycle.oc_output_tokens ?? 0) + (cycle.oc_cache_tokens ?? 0)
  const ccTools = cycle.cc_tool_counts ? Object.values(cycle.cc_tool_counts).reduce((s, c) => s + c, 0) : 0
  const ocTools = cycle.oc_tool_counts ? Object.values(cycle.oc_tool_counts).reduce((s, c) => s + c, 0) : 0

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10,
      padding: 8, background: BG_CARD, borderRadius: 8, border: `1px solid ${BORDER}`,
    }}>
      <div>
        <div style={{ fontSize: 8, color: CC_COLOR, fontWeight: 700 }}>Claude Code</div>
        <div style={{ fontSize: 8, color: '#8b949e', marginTop: 2 }}>
          {ccCost > 0 || ccTotalToks > 0 || ccTools > 0
            ? `$${ccCost.toFixed(2)} (${ccPct}%) · ${fmtTokens(ccTotalToks)} tok · ${ccTools} calls`
            : '—'}
        </div>
        <div style={{ fontSize: 7, color: DIM_COLOR }}>{fmtModel(cycle.cc_model)}</div>
      </div>
      <div>
        <div style={{ fontSize: 8, color: OC_COLOR, fontWeight: 700 }}>OpenCode</div>
        <div style={{ fontSize: 8, color: '#8b949e', marginTop: 2 }}>
          {ocCost > 0 || ocTotalToks > 0 || ocTools > 0
            ? `$${ocCost.toFixed(2)} (${ocPct}%) · ${cycle.oc_tokens_estimated ? '~' : ''}${fmtTokens(ocTotalToks)} tok · ${ocTools} calls`
            : '—'}
        </div>
        <div style={{ fontSize: 7, color: DIM_COLOR }}>{fmtModel(cycle.oc_model)}</div>
      </div>
    </div>
  )
}

function SidePanel({ cycle, onClose }: { cycle: OrchCycle; onClose: () => void }) {
  const trace = cycle.trace
  const ccCost = cycle.cc_cost ?? 0
  const ocCost = cycle.oc_cost ?? 0

  return (
    <div style={{
      width: 420, flexShrink: 0, borderLeft: `1px solid ${BORDER}`, background: BG_DARK,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>#{cycle.index} {cycle.label}</span>
          <span style={{
            fontSize: 10, color: cycleStatusColor(cycle), fontWeight: 600,
            padding: '1px 6px', borderRadius: 4, background: `${cycleStatusColor(cycle)}18`,
          }}>
            {cycle.status === 'error' ? 'ERROR' : cycle.status === 'verify_failed' ? 'VERIFY FAILED' : cycle.verified === true ? 'VERIFIED' : cycle.status === 'active' ? 'ACTIVE' : cycle.status === 'success' ? 'DONE' : '—'}
          </span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: DIM_COLOR, padding: 2 }}>
          <XIcon size={14} />
        </button>
      </div>

      <div style={{ padding: 12, flex: 1, overflowY: 'auto' }}>

        <CostDonut ccCost={ccCost} ocCost={ocCost} />

        <PhaseSummaryCard cycle={cycle} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          <div style={{ border: `1px solid ${CC_COLOR}30`, borderRadius: 8, padding: 10, background: `${CC_COLOR}08` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Cpu size={12} color={CC_COLOR} />
              <span style={{ fontSize: 11, fontWeight: 700, color: CC_COLOR }}>Claude Code</span>
              {cycle.cc_model && <span style={{ fontSize: 8, color: DIM_COLOR, fontFamily: 'monospace' }}>{fmtModel(cycle.cc_model)}</span>}
            </div>
            {cycle.cc_input_tokens != null && cycle.cc_output_tokens != null && (
              <TokenRow label="Tokens" inToks={cycle.cc_input_tokens} outToks={cycle.cc_output_tokens} cacheToks={cycle.cc_cache_tokens} color={CC_COLOR} />
            )}
            {cycle.cc_tool_counts != null && Object.keys(cycle.cc_tool_counts).length > 0 && (
              <div style={{ borderTop: `1px solid ${CC_COLOR}20`, paddingTop: 6, marginTop: 4 }}>
                <div style={{ fontSize: 8, color: DIM_COLOR, marginBottom: 3, fontWeight: 600 }}>Tool calls</div>
                <ToolCountChart counts={cycle.cc_tool_counts} color={CC_COLOR} />
              </div>
            )}
            <div style={{ borderTop: `1px solid ${CC_COLOR}20`, paddingTop: 6, marginTop: 6 }}>
              <div style={{ fontSize: 8, color: DIM_COLOR, marginBottom: 3, fontWeight: 600 }}>Phase events</div>
              <EventTimeline events={cycle.cc_events} max={6} />
            </div>
            <PromptExchange cycle={cycle} tool="cc" color={CC_COLOR} />
            {trace.artifacts && trace.artifacts.length > 0 && (
              <div style={{ borderTop: `1px solid ${CC_COLOR}20`, paddingTop: 6, marginTop: 6 }}>
                <div style={{ fontSize: 8, color: DIM_COLOR, marginBottom: 3, fontWeight: 600 }}>Artifacts</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                  {trace.artifacts.map((a, i) => (
                    <span key={i} style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: `${CC_COLOR}18`, color: CC_COLOR }}>{a}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ border: `1px solid ${OC_COLOR}30`, borderRadius: 8, padding: 10, background: `${OC_COLOR}08` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Bot size={12} color={OC_COLOR} />
              <span style={{ fontSize: 11, fontWeight: 700, color: OC_COLOR }}>OpenCode</span>
              {cycle.oc_model && <span style={{ fontSize: 8, color: DIM_COLOR, fontFamily: 'monospace' }}>{fmtModel(cycle.oc_model)}</span>}
            </div>
            {cycle.oc_input_tokens != null && cycle.oc_output_tokens != null && (
              <TokenRow label="Tokens" inToks={cycle.oc_input_tokens} outToks={cycle.oc_output_tokens} cacheToks={cycle.oc_cache_tokens} color={OC_COLOR} estimated={cycle.oc_tokens_estimated} />
            )}
            {cycle.oc_tool_counts != null && Object.keys(cycle.oc_tool_counts).length > 0 && (
              <div style={{ borderTop: `1px solid ${OC_COLOR}20`, paddingTop: 6, marginTop: 4 }}>
                <div style={{ fontSize: 8, color: DIM_COLOR, marginBottom: 3, fontWeight: 600 }}>Tool calls</div>
                <ToolCountChart counts={cycle.oc_tool_counts} color={OC_COLOR} />
              </div>
            )}
            <div style={{ borderTop: `1px solid ${OC_COLOR}20`, paddingTop: 6, marginTop: 6 }}>
              <div style={{ fontSize: 8, color: DIM_COLOR, marginBottom: 3, fontWeight: 600 }}>Phase events</div>
              <EventTimeline events={cycle.oc_events} max={6} />
            </div>
            <PromptExchange cycle={cycle} tool="oc" color={OC_COLOR} />
            {trace.files_changed && trace.files_changed.length > 0 && (
              <div style={{ borderTop: `1px solid ${OC_COLOR}20`, paddingTop: 6, marginTop: 6 }}>
                <div style={{ fontSize: 8, color: DIM_COLOR, marginBottom: 3, fontWeight: 600 }}>Files changed ({trace.files_changed.length})</div>
                <FilesChanged files={trace.files_changed} />
              </div>
            )}
            {trace.skills_used && trace.skills_used.length > 0 && (
              <div style={{ borderTop: `1px solid ${OC_COLOR}20`, paddingTop: 6, marginTop: 6 }}>
                <div style={{ fontSize: 8, color: DIM_COLOR, marginBottom: 3, fontWeight: 600 }}>Skills</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                  {trace.skills_used.map((s, i) => (
                    <span key={i} style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: '#a371f722', color: '#a371f7' }}>{s}</span>
                  ))}
                </div>
              </div>
            )}
            {trace.git_commit && (
              <div style={{ borderTop: `1px solid ${OC_COLOR}20`, paddingTop: 6, marginTop: 6, fontSize: 8, color: DIM_COLOR, display: 'flex', alignItems: 'center', gap: 3 }}>
                <GitCommit size={8} color={DIM_COLOR} /> {trace.git_commit}
              </div>
            )}
          </div>
        </div>

        {(trace.verification || cycle.verified !== null) && (
          <div style={{ marginTop: 8, padding: 8, border: `1px solid ${BORDER}`, borderRadius: 8, background: BG_CARD }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#c9d1d9', marginBottom: 4 }}>Verification</div>
            {trace.verification && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 9 }}>
                <VerificationRow label="tsc" passed={trace.verification.tsc_passed} errors={trace.verification.tsc_errors} />
                <VerificationRow label="tests" passed={trace.verification.tests_passed} errors={trace.verification.tests_errors} />
              </div>
            )}
            {cycle.verified !== null && !trace.verification && (
              <span style={{ fontSize: 9, fontWeight: 600, color: cycle.verified ? OC_COLOR : WARN_COLOR }}>
                {cycle.verified ? 'verify OK' : 'verify failed'}
              </span>
            )}
          </div>
        )}

        {trace.disagreements > 0 || trace.simplifications > 0 ? (
          <div style={{ marginTop: 8, padding: 8, border: `1px solid ${BORDER}`, borderRadius: 8, background: BG_CARD }}>
            {trace.disagreements > 0 && (
              <div>
                <div style={{ fontSize: 9, color: '#a371f7', fontWeight: 600, marginBottom: 3 }}>
                  <HelpCircle size={9} style={{ display: 'inline' }} /> {trace.disagreements} disagreement{trace.disagreements !== 1 ? 's' : ''}
                </div>
                {trace.disagreement_texts.length > 0 && trace.disagreement_texts.map((t, i) => (
                  <div key={i} style={{ fontSize: 8, color: '#8b6fc4', fontFamily: 'monospace', marginTop: 2 }}>{t}</div>
                ))}
              </div>
            )}
            {trace.simplifications > 0 && (
              <div style={{ fontSize: 9, color: DIM_COLOR, marginTop: trace.disagreements > 0 ? 6 : 0 }}>
                <RepeatIcon size={9} style={{ display: 'inline' }} /> {trace.simplifications} simplification{trace.simplifications !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function KpiCard({ label, value, trend, color }: { label: string; value: string; trend: React.ReactNode; color: string }) {
  return (
    <div style={{
      flex: 1, minWidth: 120, padding: '8px 12px', background: BG_CARD,
      border: `1px solid ${BORDER}`, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ fontSize: 8, color: DIM_COLOR, fontWeight: 600, letterSpacing: '0.04em' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color }}>{value}</span>
        {trend}
      </div>
    </div>
  )
}

function PhaseChip({ label, status, verified, color, tools }: { label: string; status: string; verified: boolean | null; color: string; tools?: number }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: `${color}15`,
      color, border: `1px solid ${color}30`, whiteSpace: 'nowrap', cursor: 'default',
    }}>
      {label}
      {tools !== undefined && ` (${tools} tools)`}
      {status === 'error' && ' ✗'}
      {status === 'verify_failed' && ' !'}
      {verified === true && ' ✓'}
    </div>
  )
}

function BarTooltip({ cycle, bar }: { cycle: OrchCycle; bar: GanttBar }) {
  const isCC = bar.tool === 'cc'
  const color = isCC ? CC_COLOR : OC_COLOR
  const cost = isCC ? cycle.cc_cost : cycle.oc_cost
  const inputToks = isCC ? cycle.cc_input_tokens : cycle.oc_input_tokens
  const outputToks = isCC ? cycle.cc_output_tokens : cycle.oc_output_tokens
  const cacheToks = isCC ? cycle.cc_cache_tokens : cycle.oc_cache_tokens
  const model = isCC ? cycle.cc_model : cycle.oc_model
  const toolCounts = isCC ? cycle.cc_tool_counts : cycle.oc_tool_counts
  const totalTools = toolCounts ? Object.values(toolCounts).reduce((s, c) => s + c, 0) : 0

  return (
    <div style={{
      background: BG_CARD, border: `1px solid ${color}44`, borderRadius: 8, padding: '8px 10px',
      fontSize: 9, color: '#c9d1d9', minWidth: 180, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color, fontSize: 10 }}>#{bar.cycleIdx} {bar.label} · {isCC ? 'CC' : 'OC'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', fontFamily: 'monospace', fontSize: 8 }}>
        <span style={{ color: DIM_COLOR }}>Cost</span>
        <span style={{ fontWeight: 600 }}>${cost !== null ? cost.toFixed(2) : '—'}</span>
        {model && <><span style={{ color: DIM_COLOR }}>Model</span><span>{fmtModel(model)}</span></>}
        {inputToks !== null && <><span style={{ color: DIM_COLOR }}>In</span><span>{fmtTokens(inputToks)}</span></>}
        {outputToks !== null && <><span style={{ color: DIM_COLOR }}>Out</span><span>{fmtTokens(outputToks)}</span></>}
        {cacheToks !== null && cacheToks > 0 && <><span style={{ color: DIM_COLOR }}>Cache</span><span>{fmtTokens(cacheToks)}</span></>}
        <span style={{ color: DIM_COLOR }}>Tools</span>
        <span>{toolCounts
          ? Object.entries(toolCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([n, c]) => `${n}: ${c}`)
              .join(' · ')
          : '—'}</span>
        <span style={{ color: DIM_COLOR }}>Dur</span>
        <span>{fmtDuration(bar.duration)}</span>
      </div>
    </div>
  )
}

function GanttTimeline({ cycles, onSelectCycle, selectedIdx }: {
  cycles: OrchCycle[]; onSelectCycle: (idx: number) => void; selectedIdx: number | null;
}) {
  if (cycles.length === 0) return null

  const allTs = cycles.flatMap(c => [
    ...c.cc_events.map(e => e.full_ts),
    ...c.oc_events.map(e => e.full_ts),
    ...c.cc_events.map(e => e.full_ts + (e.duration_secs ?? 0) * 1000),
    ...c.oc_events.map(e => e.full_ts + (e.duration_secs ?? 0) * 1000),
  ])
  const baseTs = allTs.length > 0 ? Math.min(...allTs) : Date.now()
  const endTs = Math.max(...allTs, baseTs + 1000)
  const totalDur = Math.max(endTs - baseTs, 1000)

  const ccBars: GanttBar[] = cycles.map(c => {
    const start = c.cc_events.length > 0 ? Math.min(...c.cc_events.map(e => e.full_ts)) : (c.oc_events[0]?.full_ts ?? baseTs)
    const end = c.cc_events.length > 0 ? Math.max(...c.cc_events.map(e => e.full_ts + (e.duration_secs ?? 0) * 1000)) : start
    const cDur = c.cc_events.reduce((s, e) => s + (e.duration_secs ?? 0), 0)
    return {
      cycleIdx: c.index, label: c.label, status: c.status, verified: c.verified,
      leftPct: ((start - baseTs) / totalDur) * 100,
      widthPct: Math.max(((end - start) / totalDur) * 100, 3),
      cost: c.cc_cost, duration: cDur > 0 ? cDur : null, tool: 'cc' as const,
    }
  })
  const ocBars: GanttBar[] = cycles.map(c => {
    const start = c.oc_events.length > 0 ? Math.min(...c.oc_events.map(e => e.full_ts)) : baseTs
    const end = c.oc_events.length > 0 ? Math.max(...c.oc_events.map(e => e.full_ts + (e.duration_secs ?? 0) * 1000)) : start
    const cDur = c.oc_events.reduce((s, e) => s + (e.duration_secs ?? 0), 0)
    return {
      cycleIdx: c.index, label: c.label, status: c.status, verified: c.verified,
      leftPct: ((start - baseTs) / totalDur) * 100,
      widthPct: Math.max(((end - start) / totalDur) * 100, 3),
      cost: c.oc_cost, duration: cDur > 0 ? cDur : null, tool: 'oc' as const,
    }
  })

  const ROW_H = 16
  const PHASE_H = 18
  const totalHeight = (ROW_H * 2 + PHASE_H) * cycles.length

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', padding: '4px 0', scrollbarWidth: 'thin', flex: 1 }}>
      <div style={{ position: 'relative', minWidth: 300, height: totalHeight, margin: '0 8px' }}>
        {cycles.map((c, i) => {
          const yBase = i * (ROW_H * 2 + PHASE_H)
          const ccBar = ccBars[i]
          const ocBar = ocBars[i]
          const barColor = STATUS_COLORS[c.status] ?? DIM_COLOR
          const isSelected = selectedIdx === i
          return (
            <div key={i} style={{ position: 'absolute', top: yBase, left: 0, right: 0, height: ROW_H * 2 + PHASE_H }}>
              <GanttRow
                label="CC" color={CC_COLOR} bars={[ccBar]} y={0} rowH={ROW_H}
                barColor={c.status === 'error' ? ERR_COLOR : c.status === 'verify_failed' ? WARN_COLOR : CC_COLOR}
                isSelected={isSelected} onClick={() => onSelectCycle(i)} cycle={c}
              />
              <GanttRow
                label="OC" color={OC_COLOR} bars={[ocBar]} y={ROW_H} rowH={ROW_H}
                barColor={c.status === 'error' ? ERR_COLOR : c.status === 'verify_failed' ? WARN_COLOR : OC_COLOR}
                isSelected={isSelected} onClick={() => onSelectCycle(i)} cycle={c}
              />
              <div style={{ position: 'absolute', top: ROW_H * 2, left: 0, right: 0, height: PHASE_H, display: 'flex', alignItems: 'center', gap: 4 }}>
                <PhaseChip label={c.label} status={c.status} verified={c.verified} color={barColor}
                  tools={(c.cc_tool_counts ? Object.values(c.cc_tool_counts).reduce((s, v) => s + v, 0) : 0) + (c.oc_tool_counts ? Object.values(c.oc_tool_counts).reduce((s, v) => s + v, 0) : 0)} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GanttRow({ label, color, bars, y, rowH, barColor, isSelected, onClick, cycle }: {
  label: string; color: string; bars: GanttBar[]; y: number; rowH: number;
  barColor: string; isSelected: boolean; onClick: () => void; cycle: OrchCycle;
}) {
  const [hovered, setHovered] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const totalTools = bars[0]?.tool === 'cc'
    ? Object.values(cycle.cc_tool_counts ?? {}).reduce((s, c) => s + c, 0)
    : Object.values(cycle.oc_tool_counts ?? {}).reduce((s, c) => s + c, 0)

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setTooltipPos({ x: e.clientX + 10, y: e.clientY - 10 })
  }, [])

  return (
    <>
      <div style={{ position: 'absolute', top: y, left: 0, right: 0, height: rowH, display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 8, fontWeight: 700, color, minWidth: 18, letterSpacing: '0.06em' }}>{label}</span>
        <div style={{ flex: 1, position: 'relative', height: rowH - 2 }}>
          {bars.map((bar, i) => (
            <div
              key={i}
              onClick={onClick}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              onMouseMove={handleMouseMove}
              style={{
                position: 'absolute', left: `${bar.leftPct}%`, width: `${bar.widthPct}%`,
                top: 1, height: rowH - 4, borderRadius: 3, background: barColor,
                opacity: isSelected ? 1 : hovered ? 0.9 : 0.55,
                cursor: 'pointer', transition: 'opacity 0.15s',
                border: isSelected ? `1px solid ${color}` : 'none',
                minWidth: 4, display: 'flex', alignItems: 'center', paddingLeft: 4, overflow: 'hidden',
              }}
            >
              {bar.widthPct > 30 ? (
                <div style={{
                  fontSize: 6, color: 'rgba(255,255,255,0.9)', fontWeight: 600, whiteSpace: 'nowrap',
                  textShadow: '0 0 4px rgba(0,0,0,0.6)', fontFamily: 'monospace',
                }}>
                  ${bar.cost?.toFixed(2) ?? '—'} · {totalTools} tools
                </div>
              ) : bar.widthPct > 20 ? (
                <div style={{
                  fontSize: 6, color: 'rgba(255,255,255,0.9)', fontWeight: 600, whiteSpace: 'nowrap',
                  textShadow: '0 0 4px rgba(0,0,0,0.6)', fontFamily: 'monospace',
                }}>
                  {totalTools} tools
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {hovered && bars[0] && (
        <div style={{ position: 'fixed', left: tooltipPos.x, top: tooltipPos.y, zIndex: 1000, pointerEvents: 'none' }}>
          <BarTooltip cycle={cycle} bar={bars[0]} />
        </div>
      )}
    </>
  )
}

const TOOL_TREND_COLORS: Record<string, string> = { Read: '#58a6ff', Edit: '#3fb950', Bash: '#d29922', Other: '#484f58' }

function ToolTrendChart({ cycles }: { cycles: OrchCycle[] }) {
  const data: CycleToolTrend[] = useMemo(() => cycles.map(c => {
    const cc = c.cc_tool_counts ?? {}
    const oc = c.oc_tool_counts ?? {}
    const merged: Record<string, number> = {}
    for (const [k, v] of [...Object.entries(cc), ...Object.entries(oc)]) merged[k] = (merged[k] ?? 0) + v
    return {
      cycleIdx: c.index,
      label: c.label.length > 20 ? c.label.slice(0, 20) + '…' : c.label,
      Read: merged['Read'] ?? 0,
      Edit: merged['Edit'] ?? 0,
      Bash: merged['Bash'] ?? 0,
      Other: Object.entries(merged).filter(([k]) => !['Read', 'Edit', 'Bash'].includes(k)).reduce((s, [, v]) => s + v, 0),
    }
  }), [cycles])

  return (
    <div style={{ padding: '6px 16px', borderBottom: `1px solid ${BORDER}`, background: BG_DARK, flexShrink: 0 }}>
      <div style={{ fontSize: 9, color: DIM_COLOR, fontWeight: 600, marginBottom: 4 }}>Tool calls per cycle</div>
      <ResponsiveContainer width="100%" height={140}>
        <RechartLine data={data} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
          <XAxis dataKey="cycleIdx" tick={{ fontSize: 9, fill: '#8b949e' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: '#8b949e' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <RechartTooltip
            contentStyle={{ background: BG_CARD, border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 10 }}
            formatter={(value: number, name: string) => [value, name]}
            labelFormatter={(idx) => `Cycle ${idx}`}
          />
          <Legend wrapperStyle={{ fontSize: 9, color: '#c9d1d9' }} />
          {['Read', 'Edit', 'Bash', 'Other'].map(tool => (
            <Line key={tool} type="monotone" dataKey={tool} stroke={TOOL_TREND_COLORS[tool]} strokeWidth={2} dot={{ r: 3 }} name={tool} />
          ))}
        </RechartLine>
      </ResponsiveContainer>
    </div>
  )
}

function SessionTable({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionTableRow[]>([])
  const [sortKey, setSortKey] = useState<keyof SessionTableRow>('cost')
  const [sortAsc, setSortAsc] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/orchestration/sessions')
      .then(r => r.ok ? r.json() : [])
      .then((d: SessionTableRow[]) => { setSessions(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const sorted = useMemo(() => {
    const copy = [...sessions]
    copy.sort((a, b) => {
      const va = a[sortKey] ?? 0
      const vb = b[sortKey] ?? 0
      return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
    })
    return copy
  }, [sessions, sortKey, sortAsc])

  const toggleSort = (key: keyof SessionTableRow) => {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(false) }
  }

  const SortHeader = ({ label, field }: { label: string; field: keyof SessionTableRow }) => (
    <th onClick={() => toggleSort(field)} style={{ padding: '4px 8px', fontSize: 9, fontWeight: 700, color: DIM_COLOR, textAlign: 'left', cursor: 'pointer', borderBottom: `1px solid ${BORDER}`, userSelect: 'none' }}>
      {label} {sortKey === field ? (sortAsc ? '▲' : '▼') : ''}
    </th>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: BG_DARK, border: `1px solid ${BORDER}`, borderRadius: 12, width: '90%', maxWidth: 700, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>Sessions in run</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: DIM_COLOR, padding: 2 }}><XIcon size={14} /></button>
        </div>
        <div style={{ overflow: 'auto', flex: 1, padding: 8 }}>
          {loading ? (
            <div style={{ fontSize: 10, color: DIM_COLOR, textAlign: 'center', padding: 20 }}>Loading...</div>
          ) : sorted.length === 0 ? (
            <div style={{ fontSize: 10, color: DIM_COLOR, textAlign: 'center', padding: 20 }}>No sessions in range</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
              <thead>
                <tr>
                  <SortHeader label="ID" field="id" />
                  <SortHeader label="Cost" field="cost" />
                  <SortHeader label="Input" field="input_tokens" />
                  <SortHeader label="Output" field="output_tokens" />
                  <SortHeader label="Model" field="model" />
                  <SortHeader label="Source" field="source" />
                </tr>
              </thead>
              <tbody>
                {sorted.map(s => (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <td style={{ padding: '4px 8px', fontFamily: 'monospace', color: '#8b949e', fontSize: 8 }}>{s.id.slice(0, 16)}</td>
                    <td style={{ padding: '4px 8px', fontWeight: 600, color: '#c9d1d9' }}>${s.cost.toFixed(2)}</td>
                    <td style={{ padding: '4px 8px', color: '#8b949e' }}>{fmtTokens(s.input_tokens)}</td>
                    <td style={{ padding: '4px 8px', color: '#8b949e' }}>{fmtTokens(s.output_tokens)}</td>
                    <td style={{ padding: '4px 8px', color: DIM_COLOR, fontFamily: 'monospace', fontSize: 8 }}>{fmtModel(s.model)}</td>
                    <td style={{ padding: '4px 8px', color: s.source === 'claude-code' ? CC_COLOR : OC_COLOR, fontWeight: 600 }}>{s.source === 'claude-code' ? 'CC' : 'OC'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function DiffPanel({ diffs, runA, runB, onClose }: { diffs: CycleDiff[]; runA: DiffResult['runA']; runB: DiffResult['runB']; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: BG_DARK, border: `1px solid ${BORDER}`, borderRadius: 12, width: '90%', maxWidth: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>Run diff</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: DIM_COLOR, padding: 2 }}><XIcon size={14} /></button>
        </div>
        <div style={{ padding: '0 14px', fontSize: 9, color: DIM_COLOR }}>
          <span style={{ color: CC_COLOR }}>A: {runA.project}</span> vs <span style={{ color: OC_COLOR }}>B: {runB.project}</span>
        </div>
        <div style={{ overflow: 'auto', flex: 1, padding: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 8px', fontSize: 9, fontWeight: 700, color: DIM_COLOR, textAlign: 'left', borderBottom: `1px solid ${BORDER}` }}>Cycle</th>
                <th style={{ padding: '4px 8px', fontSize: 9, fontWeight: 700, color: DIM_COLOR, textAlign: 'right', borderBottom: `1px solid ${BORDER}` }}>Cost Δ</th>
                <th style={{ padding: '4px 8px', fontSize: 9, fontWeight: 700, color: DIM_COLOR, textAlign: 'right', borderBottom: `1px solid ${BORDER}` }}>Dur Δ</th>
                <th style={{ padding: '4px 8px', fontSize: 9, fontWeight: 700, color: DIM_COLOR, textAlign: 'right', borderBottom: `1px solid ${BORDER}` }}>Tools Δ</th>
                <th style={{ padding: '4px 8px', fontSize: 9, fontWeight: 700, color: DIM_COLOR, textAlign: 'center', borderBottom: `1px solid ${BORDER}` }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map(d => {
                const costColor = d.costDiff > 0.01 ? ERR_COLOR : d.costDiff < -0.01 ? OC_COLOR : DIM_COLOR
                const durColor = d.durDiff > 10 ? ERR_COLOR : d.durDiff < -10 ? OC_COLOR : DIM_COLOR
                const toolsColor = d.toolsDiff > 0 ? ERR_COLOR : d.toolsDiff < 0 ? OC_COLOR : DIM_COLOR
                return (
                  <tr key={d.index} style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <td style={{ padding: '4px 8px', fontWeight: 600, color: '#c9d1d9' }}>#{d.index} {d.label}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, color: costColor }}>
                      {d.costDiff > 0.01 ? `↑$${d.costDiff.toFixed(2)}` : d.costDiff < -0.01 ? `↓$${Math.abs(d.costDiff).toFixed(2)}` : '='}
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, color: durColor }}>
                      {d.durDiff > 10 ? `↑${fmtDuration(d.durDiff)}` : d.durDiff < -10 ? `↓${fmtDuration(Math.abs(d.durDiff))}` : '='}
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, color: toolsColor }}>
                      {d.toolsDiff > 0 ? `↑${d.toolsDiff}` : d.toolsDiff < 0 ? `↓${Math.abs(d.toolsDiff)}` : '='}
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'center', fontSize: 8 }}>
                      <span style={{ color: d.statusB === 'success' ? OC_COLOR : d.statusB === 'error' ? ERR_COLOR : WARN_COLOR }}>
                        {d.statusB ?? '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function PromptExchange({ cycle, tool, color }: { cycle: OrchCycle; tool: 'cc' | 'oc'; color: string }) {
  const [prompts, setPrompts] = useState<{ text_preview: string; tool_calls: string[] }[]>([])
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!expanded || prompts.length > 0 || loading) return
    setLoading(true)
    const sessionId = tool === 'cc' ? cycle.cc_session_id : cycle.oc_session_id
    if (!sessionId) { setLoading(false); return }
    fetch(`/prompts?session_id=${sessionId}`)
      .then(r => r.ok ? r.json() : { prompts: [] })
      .then(d => { setPrompts(d.prompts ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [expanded, cycle.cc_session_id, cycle.oc_session_id, tool, prompts.length, loading])

  if (!cycle.cc_cost && !cycle.oc_cost) return null

  return (
    <div style={{ borderTop: `1px solid ${color}20`, paddingTop: 6, marginTop: 6 }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{ fontSize: 8, color: DIM_COLOR, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
      >
        {expanded ? '▼' : '▶'} Prompts ({prompts.length})
      </div>
      {expanded && (
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {loading && <div style={{ fontSize: 8, color: DIM_COLOR }}>Loading...</div>}
          {!loading && prompts.length === 0 && <div style={{ fontSize: 8, color: DIM_COLOR }}>No prompts found</div>}
          {prompts.slice(0, 5).map((p, i) => (
            <div key={i} style={{ fontSize: 7, color: '#8b949e', padding: '3px 6px', background: `${color}08`, borderRadius: 4, borderLeft: `2px solid ${color}44` }}>
              <div style={{ fontFamily: 'monospace', lineHeight: 1.4 }}>
                {(p.text_preview ?? '(no preview)').slice(0, 120)}
                {(p.text_preview?.length ?? 0) > 120 ? '…' : ''}
              </div>
              {p.tool_calls && p.tool_calls.length > 0 && (
                <div style={{ color: DIM_COLOR, marginTop: 1 }}>{p.tool_calls.length} tool calls</div>
              )}
            </div>
          ))}
          {prompts.length > 5 && <div style={{ fontSize: 7, color: DIM_COLOR }}>+{prompts.length - 5} more</div>}
        </div>
      )}
    </div>
  )
}

export function OrchestrateView() {
  const [data, setData] = useState<OrchTimeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedCycle, setSelectedCycle] = useState<number | null>(null)
  const [runs, setRuns] = useState<OrchRunSummary[]>([])
  const [selectedRunKey, setSelectedRunKey] = useState<string | null>(null)
  const [historicalData, setHistoricalData] = useState<OrchTimeline | null>(null)
  const [aggregates, setAggregates] = useState<OrchAggregates | null>(null)
  const [resolveText, setResolveText] = useState('')
  const [showResolveInput, setShowResolveInput] = useState(false)
  const [showTrend, setShowTrend] = useState(true)
  const [showSessions, setShowSessions] = useState(false)
  const [showSpecs, setShowSpecs] = useState(false)
  const [diffData, setDiffData] = useState<DiffResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  const fetchData = useCallback(() => {
    fetch('/api/orchestration/timeline')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const fetchRuns = useCallback(() => {
    fetch('/api/orchestration/runs')
      .then(r => r.ok ? r.json() : [])
      .then((rs: OrchRunSummary[]) => setRuns(rs))
      .catch(() => {})
  }, [])

  const fetchAggregates = useCallback(() => {
    fetch('/api/orchestration/stats')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setAggregates(d))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchData(); fetchRuns(); fetchAggregates()
    pollRef.current = setInterval(fetchData, 3_000)
    return () => clearInterval(pollRef.current)
  }, [fetchData, fetchRuns, fetchAggregates])

  const handleRunSelect = useCallback((runKey: string) => {
    if (!runKey) { setSelectedRunKey(null); setHistoricalData(null); return }
    setSelectedRunKey(runKey); setSelectedCycle(null)
    fetch(`/api/orchestration/runs/${runKey}`)
      .then(r => r.ok ? r.json() : null)
      .then(run => setHistoricalData(run ?? null))
      .catch(() => setHistoricalData(null))
  }, [])

  const handleEmergencyStop = useCallback(() => {
    if (!window.confirm('Emergency stop — halt the orchestration?')) return
    setSubmitting(true)
    fetch('/api/orchestration/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'emergency_stop' }),
    }).then(() => { fetchData(); setSubmitting(false) }).catch(() => setSubmitting(false))
  }, [fetchData])

  const handleResolveDoubts = useCallback(() => {
    if (!resolveText.trim()) return
    setSubmitting(true)
    fetch('/api/orchestration/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolve_doubts', response: resolveText.trim() }),
    }).then(() => { setResolveText(''); setShowResolveInput(false); fetchData(); setSubmitting(false) }).catch(() => setSubmitting(false))
  }, [resolveText, fetchData])

  const handleExportJson = useCallback(() => {
    const exportData = selectedRunKey ? historicalData : data
    if (!exportData) return
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `orchestration-${exportData.project_name ?? 'run'}-${new Date().toISOString().slice(0, 10)}.json`
    a.click(); URL.revokeObjectURL(url)
  }, [data, historicalData, selectedRunKey])

  const handleDiff = useCallback(() => {
    if (!selectedRunKey || !data) return
    const currentRunKey = `${data.project_path}::${data.started_at ?? 'unknown'}`
    const a = encodeURIComponent(selectedRunKey)
    const b = encodeURIComponent(currentRunKey)
    fetch(`/api/orchestration/diff?runA=${a}&runB=${b}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setDiffData(d))
      .catch(() => {})
  }, [selectedRunKey, data])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!data && !historicalData) return
    const cycles = (selectedRunKey ? historicalData : data)?.cycles ?? []
    if (cycles.length === 0) return
    if (e.key === 'ArrowRight') setSelectedCycle(prev => prev === null ? 0 : Math.min(prev + 1, cycles.length - 1))
    else if (e.key === 'ArrowLeft') setSelectedCycle(prev => prev === null ? cycles.length - 1 : Math.max(prev - 1, 0))
    else if (e.key === 'Escape') setSelectedCycle(null)
  }, [data, historicalData, selectedRunKey])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const displayData = (selectedRunKey ? historicalData : data) as OrchTimeline | null
  const isActiveView = !selectedRunKey

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b949e', fontSize: 13 }}>
        Loading orchestration data...
      </div>
    )
  }

  if ((!data || data.status === 'none') && !selectedRunKey) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: '#8b949e' }}>
        <Workflow size={32} color="#21262d" />
        <div style={{ fontSize: 14, fontWeight: 600, color: '#c9d1d9' }}>CC+OC Workflow Orchestrator</div>
        <div style={{ fontSize: 11, maxWidth: 400, textAlign: 'center', lineHeight: 1.6, color: '#8b949e' }}>
          Monitors the spec-driven handoff between Claude Code (planning/review) and OpenCode (executing/fixing).
          See the <b style={{ color: '#c9d1d9' }}>Live</b> tab for real-time tool sessions.
        </div>
        <div style={{ fontSize: 11, maxWidth: 360, textAlign: 'center', lineHeight: 1.6, color: '#484f58' }}>
          Run <code style={{ background: BG_CARD, padding: '2px 6px', borderRadius: 3, fontSize: 10, color: '#7d8590' }}>orchestrate.sh "goal" /path/to/project</code> to start
      </div>
    </div>
  )
}

function LiveProgress({ events, commandLog, fileChanges }: { events: OrchEvent[]; commandLog: CommandLogEntry[]; fileChanges: FileChangeEntry[] }) {
  const completedEvents = events.filter(e => e.action === 'done')
  const recentCmds = commandLog.slice(-6)
  const recentFiles = fileChanges.slice(-8)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'auto', padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#c9d1d9', fontWeight: 600, flexShrink: 0 }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: OC_COLOR, animation: 'pulse 1.5s ease-in-out infinite' }} />
        Orchestration in progress…
      </div>

      {events.length === 0 && recentCmds.length === 0 ? (
        <div style={{ fontSize: 10, color: DIM_COLOR, padding: 12, flexShrink: 0 }}>Waiting for events…</div>
      ) : (
        <>
          {/* Event log */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
            <div style={{ fontSize: 8, color: DIM_COLOR, fontWeight: 600, marginBottom: 2 }}>EVENTS</div>
            {events.map((ev, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, color: '#8b949e', fontFamily: 'monospace' }}>
                <span style={{ color: ev.tool === 'cc' ? CC_COLOR : OC_COLOR, fontWeight: 700, minWidth: 20, fontSize: 8 }}>
                  {ev.tool === 'cc' ? 'CC' : 'OC'}
                </span>
                <span style={{
                  padding: '1px 4px', borderRadius: 3, fontSize: 7, fontWeight: 600,
                  background: ev.action === 'error' ? `${ERR_COLOR}22` : ev.action === 'done' ? `${OC_COLOR}22` : `${CC_COLOR}22`,
                  color: ev.action === 'error' ? ERR_COLOR : ev.action === 'done' ? OC_COLOR : CC_COLOR,
                  minWidth: 44, textAlign: 'center',
                }}>{ev.action}</span>
                <span style={{ flex: 1, color: '#7d8590' }}>{ev.description}</span>
                {ev.duration_secs != null && <span style={{ color: DIM_COLOR }}>{fmtDuration(ev.duration_secs)}</span>}
              </div>
            ))}
          </div>

          {/* Commands */}
          {recentCmds.length > 0 && (
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontSize: 8, color: DIM_COLOR, fontWeight: 600, marginBottom: 3 }}>COMMANDS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {recentCmds.map((c, i) => (
                  <div key={i} style={{ fontSize: 8, fontFamily: 'monospace', color: '#58a6ff', padding: '2px 6px', background: '#0d1117', borderRadius: 4, lineHeight: 1.5, wordBreak: 'break-all' }}>
                    <span style={{ color: '#484f58', marginRight: 4 }}>$</span>{c.command.length > 120 ? c.command.slice(0, 120) + '…' : c.command}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* File changes */}
          {recentFiles.length > 0 && (
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontSize: 8, color: DIM_COLOR, fontWeight: 600, marginBottom: 3 }}>FILES CHANGED</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {recentFiles.map((f, i) => (
                  <span key={i} style={{ fontSize: 8, padding: '1px 6px', borderRadius: 3, background: `${OC_COLOR}12`, color: OC_COLOR, fontFamily: 'monospace', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.path}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Cycle summary */}
          {completedEvents.length > 0 && (
            <div style={{ flexShrink: 0, marginTop: 4, padding: '6px 8px', border: `1px solid ${OC_COLOR}30`, borderRadius: 6, background: `${OC_COLOR}08` }}>
              <div style={{ fontSize: 8, color: DIM_COLOR, fontWeight: 600, marginBottom: 3 }}>CYCLE COMPLETED</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 9, color: '#c9d1d9' }}>
                {completedEvents.map((ev, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontWeight: 700, color: ev.tool === 'cc' ? CC_COLOR : OC_COLOR, minWidth: 20, fontSize: 8 }}>
                      {ev.tool === 'cc' ? 'CC' : 'OC'}
                    </span>
                    <span style={{ flex: 1 }}>{ev.description}</span>
                    {ev.duration_secs != null && <span style={{ color: DIM_COLOR, fontFamily: 'monospace' }}>{fmtDuration(ev.duration_secs)}</span>}
                    {ev.verified === true && <span style={{ color: OC_COLOR }}>✓</span>}
                    {ev.verified === false && <span style={{ color: ERR_COLOR }}>✗</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  )
}

  if (!displayData) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: '#8b949e' }}>
        <Workflow size={32} color="#21262d" />
        <div style={{ fontSize: 14, fontWeight: 600, color: '#c9d1d9' }}>{selectedRunKey ? 'Run data unavailable' : 'No data available'}</div>
        {historicalData ? (
          <>
            <div style={{ fontSize: 12, color: '#7d8590', textAlign: 'center', maxWidth: 400 }}>
              {historicalData.goal && <div style={{ marginBottom: 4 }}>{historicalData.goal}</div>}
              <div style={{ fontSize: 10, color: DIM_COLOR }}>
                <StatusBadge status={historicalData.status} /> · {historicalData.completed} cycles
                {historicalData.started_at && <> · {new Date(historicalData.started_at).toLocaleDateString()}</>}
              </div>
            </div>
            <div style={{ fontSize: 10, color: DIM_COLOR }}>No snapshot data — cycle details not available for this run.</div>
            <button onClick={() => { setSelectedRunKey(null); setHistoricalData(null) }}
              style={{ fontSize: 11, padding: '6px 14px', borderRadius: 6, background: BG_CARD, color: '#c9d1d9', border: `1px solid ${BORDER}`, cursor: 'pointer' }}>
              Back to current run
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 11, color: '#8b949e' }}>Select a historical run to view its data.</div>
            <button onClick={() => { setSelectedRunKey(null); setHistoricalData(null) }}
              style={{ fontSize: 11, padding: '6px 14px', borderRadius: 6, background: BG_CARD, color: '#c9d1d9', border: `1px solid ${BORDER}`, cursor: 'pointer' }}>
              Back to current run
            </button>
          </>
        )}
      </div>
    )
  }

  const cycles = displayData?.cycles ?? []
  const hasErrors = cycles.some(c => c.status === 'error')
  const successCount = cycles.filter(c => c.status === 'success').length
  const failedCount = cycles.filter(c => c.status === 'verify_failed').length
  const errorCount = cycles.filter(c => c.status === 'error').length
  const totalPhases = displayData?.total_phases ?? 0
  const completed = displayData?.completed ?? 0
  const progressPct = totalPhases > 0 ? Math.round((completed / totalPhases) * 100) : 0

  const totCcCost = displayData?.cc_total_cost ?? 0
  const totOcCost = displayData?.oc_total_cost ?? 0
  const costSoFar = totCcCost + totOcCost
  const avgCost = cycles.length > 0 ? (cycles.reduce((s, c) => s + (c.cc_cost ?? 0) + (c.oc_cost ?? 0), 0) / cycles.length) : 0
  const avgDur = cycles.length > 0 ? (cycles.reduce((s, c) => s + (c.duration_secs ?? 0), 0) / cycles.length) : 0
  const verifyPassCount = cycles.filter(c => c.verified === true || c.status === 'success').length
  const verifyRate = cycles.length > 0 ? (verifyPassCount / cycles.length) * 100 : 0
  const remainingPhases = Math.max(0, totalPhases - completed)
  const projectedCost = aggregates && avgCost > 0
    ? costSoFar + remainingPhases * aggregates.avg_cost_per_cycle
    : null
  const projectedThreshold = aggregates && projectedCost ? aggregates.avg_cost_per_cycle * totalPhases * 1.2 : null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '6px 16px', borderBottom: `1px solid ${BORDER}`, background: BG_DARK, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Workflow size={14} color={CC_COLOR} />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>{displayData?.project_name ?? '—'}</span>
          <StatusBadge status={displayData?.status ?? 'none'} />
          {displayData?.waiting_for_user && (
            <span style={{ fontSize: 10, color: WARN_COLOR, fontWeight: 600 }}>
              <AlertTriangle size={10} style={{ display: 'inline' }} /> Waiting
            </span>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
            {runs.length > 0 && (
              <select value={selectedRunKey ?? ''} onChange={e => handleRunSelect(e.target.value)}
                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: BG_CARD, color: '#c9d1d9', border: `1px solid ${BORDER}`, cursor: 'pointer' }}>
                <option value="">Current run</option>
                {runs.map(run => (
                  <option key={run.run_key} value={run.run_key}>
                    {run.project_name ?? 'run'} — {run.started_at.slice(0, 10)} ({run.total_cycles}c)
                  </option>
                ))}
              </select>
            )}
            <button onClick={handleExportJson} title="Export JSON"
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: BG_CARD, color: '#7d8590', border: `1px solid ${BORDER}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
              <Download size={10} /> JSON
            </button>
            <button onClick={() => setShowTrend(v => !v)}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: showTrend ? `${CC_COLOR}22` : BG_CARD, color: showTrend ? CC_COLOR : '#7d8590', border: `1px solid ${showTrend ? CC_COLOR : BORDER}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
              <LineChart size={10} /> Trends
            </button>
            <button onClick={() => setShowSessions(true)}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: BG_CARD, color: '#7d8590', border: `1px solid ${BORDER}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
              <Table2 size={10} /> Sessions
            </button>
            {displayData?.spec_files && Object.keys(displayData.spec_files).length > 0 && (
              <button onClick={() => setShowSpecs(v => !v)}
                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: showSpecs ? `${CC_COLOR}22` : BG_CARD, color: showSpecs ? CC_COLOR : '#7d8590', border: `1px solid ${showSpecs ? CC_COLOR : BORDER}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                <FileCode2 size={10} /> Specs
              </button>
            )}
            {selectedRunKey && historicalData && (
              <button onClick={handleDiff}
                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${WARN_COLOR}15`, color: WARN_COLOR, border: `1px solid ${WARN_COLOR}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                <GitCommit size={10} /> Diff with current
              </button>
            )}
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Cpu size={9} color={CC_COLOR} />
              <span style={{ color: CC_COLOR, fontWeight: 600 }}>{totCcCost > 0 ? `$${totCcCost.toFixed(2)}` : '—'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Bot size={9} color={OC_COLOR} />
              <span style={{ color: OC_COLOR, fontWeight: 600 }}>{totOcCost > 0 ? `$${totOcCost.toFixed(2)}` : '—'}</span>
            </div>
            <span style={{ color: '#c9d1d9', fontWeight: 700 }}>= ${((totCcCost ?? 0) + (totOcCost ?? 0)).toFixed(2)}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: '#7d8590' }}>
            {successCount > 0 && <span style={{ color: OC_COLOR }}>{successCount} ✓</span>}
            {failedCount > 0 && <span style={{ color: WARN_COLOR }}>{failedCount} !</span>}
            {errorCount > 0 && <span style={{ color: ERR_COLOR }}>{errorCount} ✗</span>}
            <span>{cycles.length} cycle{cycles.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div style={{ fontSize: 10, color: '#7d8590', marginTop: 2 }}>{displayData?.goal}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, fontSize: 9, color: '#484f58' }}>
          {displayData?.current_phase && <span style={{ color: '#c9d1d9' }}>{displayData.current_phase}</span>}
          {totalPhases > 0 && <span style={{ color: '#c9d1d9', fontWeight: 600 }}>{completed}/{totalPhases} · {progressPct}%</span>}
          {displayData?.phase_retry != null && displayData.phase_retry > 0 && <span style={{ color: WARN_COLOR }}>retry {displayData.phase_retry}</span>}
          <span style={{ marginLeft: 'auto' }}>{fmtElapsed(displayData?.started_at ?? null)}</span>
        </div>

        {totalPhases > 0 && (
          <div style={{ height: 2, background: BORDER, borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(progressPct, 100)}%`, height: '100%', background: hasErrors ? ERR_COLOR : progressPct >= 100 ? OC_COLOR : CC_COLOR, borderRadius: 2, transition: 'width 0.5s ease' }} />
          </div>
        )}
      </div>

      {/* ── KPI Row ── */}
      <div style={{ padding: '4px 16px', borderBottom: `1px solid ${BORDER}`, background: BG_DARK, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <KpiCard label="AVG COST / CYCLE" value={avgCost > 0 ? `$${avgCost.toFixed(2)}` : '—'} trend={aggregates ? <TrendArrow current={avgCost} historical={aggregates.avg_cost_per_cycle} /> : null} color="#c9d1d9" />
          <KpiCard label="AVG DURATION" value={fmtDuration(Math.round(avgDur))} trend={aggregates ? <TrendArrow current={avgDur} historical={aggregates.avg_duration_secs} /> : null} color="#c9d1d9" />
          <KpiCard label="ERROR RATE" value={cycles.length > 0 ? `${Math.round((errorCount + failedCount) / cycles.length * 100)}%` : '—'} trend={aggregates ? <TrendArrow current={(errorCount + failedCount) / cycles.length * 100} historical={aggregates.avg_error_rate * 100} /> : null} color={errorCount > 0 ? ERR_COLOR : OC_COLOR} />
          <KpiCard label="VERIFY PASS" value={`${Math.round(verifyRate)}%`} trend={aggregates ? <TrendArrow current={verifyRate} historical={aggregates.avg_verify_pass_rate * 100} /> : null} color={verifyRate >= 80 ? OC_COLOR : WARN_COLOR} />
          {aggregates && aggregates.total_runs > 0 && (
            <KpiCard label="EST. TOTAL" value={projectedCost !== null ? `$${projectedCost.toFixed(2)}` : '—'}
              trend={projectedCost !== null && projectedThreshold ? <TrendArrow current={projectedCost} historical={aggregates.avg_cost_per_cycle * totalPhases} /> : null}
              color={projectedCost !== null && projectedThreshold && projectedCost > projectedThreshold ? WARN_COLOR : '#c9d1d9'} />
          )}
        </div>
      </div>

      {showTrend && cycles.length > 0 && (
        <ToolTrendChart cycles={cycles} />
      )}

      {/* ── Active run controls ── */}
      {isActiveView && data && (data.status === 'active' || data.status === 'paused') && (
        <div style={{ padding: '3px 16px', borderBottom: `1px solid ${BORDER}`, background: BG_DARK, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
          <button onClick={handleEmergencyStop} disabled={submitting}
            style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: `1px solid ${ERR_COLOR}`, background: `${ERR_COLOR}15`, color: ERR_COLOR, cursor: submitting ? 'not-allowed' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <StopCircle size={10} /> Emergency Stop
          </button>
          {data.waiting_for_user && (
            <>
              <button onClick={() => setShowResolveInput(v => !v)}
                style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: `1px solid ${WARN_COLOR}`, background: `${WARN_COLOR}15`, color: WARN_COLOR, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                <MessageSquare size={10} /> Resolve Doubts
              </button>
              {showResolveInput && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 250px', minWidth: 180 }}>
                  <textarea value={resolveText} onChange={e => setResolveText(e.target.value)} placeholder="Enter your response..." rows={1}
                    style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: `1px solid ${BORDER}`, background: BG_CARD, color: '#c9d1d9', flex: 1, resize: 'none', fontFamily: 'inherit' }} />
                  <button onClick={handleResolveDoubts} disabled={submitting || !resolveText.trim()}
                    style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: `1px solid ${OC_COLOR}`, background: `${OC_COLOR}22`, color: OC_COLOR, cursor: submitting || !resolveText.trim() ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
                    Send
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Main area: Gantt + SidePanel ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {cycles.length === 0 && !isActiveView ? (
            <div style={{ fontSize: 11, color: DIM_COLOR, textAlign: 'center', padding: 40 }}>
              No events recorded yet — start an orchestration to see the timeline.
            </div>
          ) : cycles.length === 0 && isActiveView ? (
            <LiveProgress events={[...(data?.cc_events ?? []), ...(data?.oc_events ?? [])].sort((a, b) => a.full_ts - b.full_ts)} commandLog={data?.command_log ?? []} fileChanges={data?.file_changes ?? []} />
          ) : (
            <div style={{ flex: 1, padding: '6px 0', overflowY: 'auto' }}>
              <GanttTimeline cycles={cycles} onSelectCycle={setSelectedCycle} selectedIdx={selectedCycle} />
            </div>
          )}
        </div>

        {selectedCycle !== null && cycles[selectedCycle] && (
          <SidePanel cycle={cycles[selectedCycle]} onClose={() => setSelectedCycle(null)} />
        )}
      </div>

      <div style={{ padding: '2px 16px', borderTop: `1px solid ${BORDER}`, background: BG_DARK, display: 'flex', alignItems: 'center', gap: 10, fontSize: 8, color: '#484f58', flexShrink: 0 }}>
        <span>Verify:</span>
        <VerificationRow label="tsc" passed={displayData?.tsc_passed ?? null} errors={displayData?.tsc_errors} />
        <VerificationRow label="tests" passed={displayData?.tests_passed ?? null} errors={displayData?.tests_errors} />
        {aggregates && aggregates.total_runs > 0 && (
          <span style={{ marginLeft: 'auto' }}>{aggregates.total_runs} historical runs · avg ${aggregates.avg_cost_per_cycle.toFixed(2)}/cycle · {fmtDuration(Math.round(avgDur))} avg</span>
        )}
        <span style={{ marginLeft: aggregates && aggregates.total_runs > 0 ? 8 : 'auto' }}>{isActiveView ? 'auto-refresh 3s' : 'historical view'}</span>
        {selectedCycle !== null && <span style={{ color: DIM_COLOR }}>← → navigate · Esc close</span>}
      </div>

      {showSessions && <SessionTable onClose={() => setShowSessions(false)} />}

      {diffData && (
        <DiffPanel diffs={diffData.diffs} runA={diffData.runA} runB={diffData.runB} onClose={() => setDiffData(null)} />
      )}

      {showSpecs && displayData?.spec_files && (
        <SpecViewer files={displayData.spec_files} onClose={() => setShowSpecs(false)} />
      )}
    </div>
  )
}

function SpecViewer({ files, onClose }: { files: Record<string, string>; onClose: () => void }) {
  const ORDER = ['SPEC.md', 'OC-TASK.md', 'OC-REPORT.md', 'PLAN.md']
  const names = [
    ...ORDER.filter(n => files[n]),
    ...Object.keys(files).filter(n => !ORDER.includes(n) && files[n]).sort(),
  ]
  const [active, setActive] = useState(names[0] ?? '')
  const content = files[active] ?? ''
  const isCompleted = active === 'OC-TASK.md' && content.trim() === 'ORCHESTRATION_COMPLETE'
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '90vw', height: '85vh', background: BG_DARK, borderRadius: 12,
        border: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0, flexWrap: 'wrap' }}>
          <FileCode2 size={14} color={CC_COLOR} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9' }}>Spec files</span>
          <div style={{ display: 'flex', gap: 2, marginLeft: 8, flexWrap: 'wrap' }}>
            {names.map(n => (
              <button key={n} onClick={() => setActive(n)}
                style={{
                  fontSize: 10, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                  background: active === n ? `${CC_COLOR}22` : 'transparent',
                  color: active === n ? CC_COLOR : '#7d8590',
                  border: active === n ? `1px solid ${CC_COLOR}44` : `1px solid transparent`,
                  fontWeight: active === n ? 600 : 400,
                }}>{n}</button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose}
            style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'transparent', color: '#7d8590', border: `1px solid ${BORDER}`, cursor: 'pointer' }}>
            <XIcon size={12} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16, fontFamily: 'monospace', fontSize: 11, color: '#c9d1d9', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {isCompleted
            ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: OC_COLOR, fontFamily: 'inherit', fontSize: 12 }}>
                <span style={{ fontSize: 16 }}>✅</span>
                <span style={{ fontWeight: 600 }}>Run completado</span>
                <span style={{ color: DIM_COLOR, fontWeight: 400 }}>— esta fase ha finalizado</span>
              </div>
            : content || <span style={{ color: DIM_COLOR }}>File not found</span>}
        </div>
      </div>
    </div>
  )
}

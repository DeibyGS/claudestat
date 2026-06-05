import { useEffect, useState, useRef, useCallback } from 'react'
import { Workflow, CheckCircle2, XCircle, AlertTriangle, Cpu, Bot, ChevronRight, Clock, X as XIcon, FileCode2, Sparkles, GitCommit, StopCircle, MessageSquare } from 'lucide-react'
import type { OrchTimeline, OrchCycle, OrchCycleTrace, OrchRunSummary } from '../types'

const CC_COLOR  = '#58a6ff'
const OC_COLOR  = '#3fb950'
const ERR_COLOR = '#f85149'
const WARN_COLOR = '#d29922'
const DIM_COLOR  = '#484f58'
const BG_DARK   = '#0d1117'
const BG_CARD   = '#161b22'
const BORDER    = '#21262d'

function fmtTokens(n: number | null): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function fmtModel(m: string | null): string {
  if (!m) return ''
  const name = m.split('/').pop() ?? m
  return name.replace(/^claude-|-\d{8}$|-latest$/g, '')
}

function fmtDuration(secs: number | null): string {
  if (secs === null || secs === 0) return ''
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

function cycleBorderColor(cycle: OrchCycle): string {
  if (cycle.status === 'error') return ERR_COLOR
  if (cycle.status === 'verify_failed') return WARN_COLOR
  if (cycle.verified === true) return OC_COLOR
  return '#30363d'
}

function cycleStatusIcon(cycle: OrchCycle): { icon: string; color: string } {
  if (cycle.status === 'error') return { icon: '✗', color: ERR_COLOR }
  if (cycle.status === 'verify_failed') return { icon: '!', color: WARN_COLOR }
  if (cycle.verified === true) return { icon: '✓', color: OC_COLOR }
  if (cycle.status === 'active') return { icon: '●', color: CC_COLOR }
  return { icon: '○', color: DIM_COLOR }
}

function actionLabel(action: string): string {
  switch (action) {
    case 'planning':   return 'Plan'
    case 'reviewing':  return 'Review'
    case 'executing':  return 'Exec'
    case 'correcting': return 'Fix'
    case 'done':        return 'Done'
    case 'error':       return 'Error'
    case 'timeout':     return 'Timeout'
    case 'paused':      return 'Paused'
    default:            return action
  }
}

function traceDetailLabel(trace: OrchCycleTrace): string | null {
  if (trace.action_detail === 'reviewing') return 'Review'
  if (trace.action_detail === 'escalation') return 'Escalation'
  if (trace.action_detail === 'planning') return 'Plan'
  return null
}

function VerificationRow({ label, passed, errors }: { label: string; passed: boolean | null; errors?: string[] }) {
  if (passed === null) return <span>{label} —</span>
  if (passed) return <span style={{ color: OC_COLOR }}><CheckCircle2 size={8} style={{ display: 'inline' }} /> {label}</span>
  const first = errors?.[0]
  return (
    <span title={errors?.join('\n')} style={{ color: ERR_COLOR, cursor: first ? 'help' : undefined }}>
      <XCircle size={8} style={{ display: 'inline' }} /> {label}
      {first && <span style={{ fontFamily: 'monospace', opacity: 0.75, marginLeft: 4 }}>
        {first.length > 55 ? first.slice(0, 55) + '…' : first}
      </span>}
    </span>
  )
}

function TokenRow({ input, output, cache }: { input: number | null; output: number | null; cache: number | null }) {
  if (input === null) return null
  return (
    <div style={{ marginTop: 5, paddingTop: 4, borderTop: `1px solid ${BORDER}`, fontSize: 8, color: DIM_COLOR, fontFamily: 'monospace' }}>
      in {fmtTokens(input)} · out {fmtTokens(output)} · cache {fmtTokens(cache)}
    </div>
  )
}

function DetailPanel({ cycle, onClose }: { cycle: OrchCycle; onClose: () => void }) {
  const trace = cycle.trace
  const ccDur = cycle.cc_events.reduce((s, e) => s + (e.duration_secs ?? 0), 0)
  const ocDur = cycle.oc_events.reduce((s, e) => s + (e.duration_secs ?? 0), 0)
  const actionDetailCC = traceDetailLabel(trace)
  const filesCount = trace.files_changed.filter(f => !f.startsWith('+') && !f.startsWith('-')).length

  return (
    <div style={{ background: BG_CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 14, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>#{cycle.index} {cycle.label}</span>
          <span style={{ fontSize: 10, color: cycleBorderColor(cycle), fontWeight: 600 }}>
            {cycle.status === 'error' ? 'ERROR' : cycle.status === 'verify_failed' ? 'VERIFY FAILED' : cycle.status === 'active' ? 'ACTIVE' : cycle.verified ? 'VERIFIED' : 'DONE'}
          </span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: DIM_COLOR, padding: 2 }}>
          <XIcon size={14} color={DIM_COLOR} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ border: `1px solid ${CC_COLOR}30`, borderRadius: 8, padding: 10, background: `${CC_COLOR}08` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Cpu size={12} color={CC_COLOR} />
            <span style={{ fontSize: 11, fontWeight: 700, color: CC_COLOR }}>Claude Code</span>
            {actionDetailCC && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${CC_COLOR}22`, color: CC_COLOR }}>{actionDetailCC}</span>}
            {cycle.cc_model && <span style={{ fontSize: 8, color: DIM_COLOR, fontFamily: 'monospace' }}>{fmtModel(cycle.cc_model)}</span>}
            {cycle.cc_cost !== null && <span style={{ fontSize: 9, color: `${CC_COLOR}cc`, fontWeight: 600, marginLeft: 'auto' }}>${cycle.cc_cost.toFixed(2)}</span>}
            {ccDur > 0 && !cycle.cc_cost && <span style={{ fontSize: 9, color: DIM_COLOR, marginLeft: 'auto' }}>{fmtDuration(ccDur)}</span>}
          </div>
          {cycle.cc_events.length === 0 ? (
            <div style={{ fontSize: 10, color: DIM_COLOR }}>No CC events</div>
          ) : (
            cycle.cc_events.map((ev, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderTop: i > 0 ? `1px solid ${BORDER}` : 'none' }}>
                <span style={{ fontSize: 10, color: DIM_COLOR, fontFamily: 'monospace', minWidth: 40 }}>{ev.ts?.slice(0, 5)}</span>
                <span style={{ fontSize: 10, color: ev.action === 'error' ? ERR_COLOR : '#c9d1d9', wordBreak: 'break-word' }}>{ev.description}</span>
                {ev.duration_secs !== null && <span style={{ fontSize: 9, color: DIM_COLOR, marginLeft: 'auto' }}>{fmtDuration(ev.duration_secs)}</span>}
              </div>
            ))
          )}
          <TokenRow input={cycle.cc_input_tokens} output={cycle.cc_output_tokens} cache={cycle.cc_cache_tokens} />
          {trace.artifacts.length > 0 && (
            <div style={{ marginTop: 6, borderTop: `1px solid ${BORDER}`, paddingTop: 4 }}>
              <div style={{ fontSize: 9, color: DIM_COLOR, marginBottom: 2 }}>Artifacts</div>
              {trace.artifacts.map((a, i) => (
                <div key={i} style={{ fontSize: 10, color: CC_COLOR }}>{a}</div>
              ))}
            </div>
          )}
        </div>

        <div style={{ border: `1px solid ${OC_COLOR}30`, borderRadius: 8, padding: 10, background: `${OC_COLOR}08` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Bot size={12} color={OC_COLOR} />
            <span style={{ fontSize: 11, fontWeight: 700, color: OC_COLOR }}>OpenCode</span>
            {cycle.oc_action && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${OC_COLOR}22`, color: OC_COLOR }}>{actionLabel(cycle.oc_action)}</span>}
            {cycle.oc_model && <span style={{ fontSize: 8, color: DIM_COLOR, fontFamily: 'monospace' }}>{fmtModel(cycle.oc_model)}</span>}
            {cycle.oc_cost !== null && <span style={{ fontSize: 9, color: `${OC_COLOR}cc`, fontWeight: 600, marginLeft: 'auto' }}>${cycle.oc_cost.toFixed(2)}</span>}
            {ocDur > 0 && !cycle.oc_cost && <span style={{ fontSize: 9, color: DIM_COLOR, marginLeft: 'auto' }}>{fmtDuration(ocDur)}</span>}
          </div>
          {(trace.git_commit || filesCount > 0 || trace.skills_used.length > 0) && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              {trace.git_commit && (
                <span style={{ fontSize: 9, color: `${OC_COLOR}99`, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <GitCommit size={9} /> {trace.git_commit.slice(0, 7)}
                </span>
              )}
              {filesCount > 0 && (
                <span style={{ fontSize: 9, color: `${OC_COLOR}99`, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <FileCode2 size={9} /> {filesCount} files
                </span>
              )}
              {trace.skills_used.length > 0 && (
                <span style={{ fontSize: 9, color: `${OC_COLOR}99`, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Sparkles size={9} /> {trace.skills_used.length} skills
                </span>
              )}
            </div>
          )}
          {cycle.oc_events.length === 0 ? (
            <div style={{ fontSize: 10, color: DIM_COLOR }}>
              {cycle.cc_action?.includes('done') ? 'Orchestration complete — OC not required' : 'No OC events'}
            </div>
          ) : (
            cycle.oc_events.map((ev, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderTop: i > 0 ? `1px solid ${BORDER}` : 'none' }}>
                <span style={{ fontSize: 10, color: DIM_COLOR, fontFamily: 'monospace', minWidth: 40 }}>{ev.ts?.slice(0, 5)}</span>
                <span style={{ fontSize: 10, color: ev.action === 'error' || ev.action === 'timeout' ? ERR_COLOR : '#c9d1d9', wordBreak: 'break-word' }}>{ev.description}</span>
                {ev.duration_secs !== null && <span style={{ fontSize: 9, color: DIM_COLOR, marginLeft: 'auto' }}>{fmtDuration(ev.duration_secs)}</span>}
              </div>
            ))
          )}
          <TokenRow input={cycle.oc_input_tokens} output={cycle.oc_output_tokens} cache={cycle.oc_cache_tokens} />
          {cycle.verified !== null && (
            <div style={{ marginTop: 6, fontSize: 10, fontWeight: 600, color: cycle.verified ? OC_COLOR : WARN_COLOR, display: 'flex', alignItems: 'center', gap: 4 }}>
              {cycle.verified ? <><CheckCircle2 size={10} /> verify OK</> : <><AlertTriangle size={10} /> verify FAILED</>}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
        {trace.verification && (
          <div style={{ fontSize: 9, color: DIM_COLOR }}>
            <VerificationRow label="tsc" passed={trace.verification.tsc_passed} errors={trace.verification.tsc_errors} /> · <VerificationRow label="tests" passed={trace.verification.tests_passed} errors={trace.verification.tests_errors} />
          </div>
        )}
        {trace.git_commit && (
          <div style={{ fontSize: 9, color: DIM_COLOR, display: 'flex', alignItems: 'center', gap: 3 }}>
            <GitCommit size={9} /> {trace.git_commit}
          </div>
        )}
        {trace.disagreements > 0 && (
          <div>
            <div style={{ fontSize: 9, color: '#a371f7', fontWeight: 600 }}>{trace.disagreements} disagreement{trace.disagreements !== 1 ? 's' : ''}</div>
            {trace.disagreement_texts.length > 0 && (
              <div style={{ marginTop: 3 }}>
                {trace.disagreement_texts.map((t, i) => (
                  <div key={i} style={{ fontSize: 9, color: '#8b6fc4', fontFamily: 'monospace', background: '#a371f710', borderRadius: 3, padding: '2px 6px', marginBottom: 2, wordBreak: 'break-word' }}>{t}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {trace.simplifications > 0 && (
          <div style={{ fontSize: 9, color: DIM_COLOR }}>{trace.simplifications} simplification{trace.simplifications !== 1 ? 's' : ''}</div>
        )}
      </div>

      {trace.files_changed.length > 0 && (
        <div style={{ marginTop: 8, borderTop: `1px solid ${BORDER}`, paddingTop: 6 }}>
          <div style={{ fontSize: 9, color: DIM_COLOR, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
            <FileCode2 size={9} /> Files changed ({filesCount})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {trace.files_changed.filter(f => !f.startsWith('+') && !f.startsWith('-')).slice(0, 12).map((f, i) => (
              <span key={i} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#21262d', color: '#8b949e' }}>{f}</span>
            ))}
            {filesCount > 12 && (
              <span style={{ fontSize: 9, color: DIM_COLOR }}>+{filesCount - 12} more</span>
            )}
          </div>
        </div>
      )}

      {trace.skills_used.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 9, color: DIM_COLOR, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Sparkles size={9} /> Skills
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {trace.skills_used.map((s, i) => (
              <span key={i} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#a371f722', color: '#a371f7' }}>{s}</span>
            ))}
          </div>
        </div>
      )}

      {trace.verification && trace.verification.grep_checks.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 9, color: DIM_COLOR, marginBottom: 3 }}>Grep checks</div>
          {trace.verification.grep_checks.map((gc, i) => (
            <div key={i} style={{ fontSize: 9, color: '#8b949e', fontFamily: 'monospace' }}>
              <code style={{ color: '#c9d1d9' }}>{gc.pattern}</code> → {gc.result}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 9, color: DIM_COLOR }}>
        <span><Clock size={9} style={{ display: 'inline', verticalAlign: -1 }} /> total: {fmtDuration(cycle.duration_secs) ?? '—'}</span>
      </div>
    </div>
  )
}

function SwimLaneCell({ cycle, agent, isSelected, onClick }: { cycle: OrchCycle; agent: 'cc' | 'oc'; isSelected: boolean; onClick: () => void }) {
  const isCC = agent === 'cc'
  const color = isCC ? CC_COLOR : OC_COLOR
  const events = isCC ? cycle.cc_events : cycle.oc_events
  const action = isCC ? cycle.cc_action : cycle.oc_action
  const dur = events.reduce((s, e) => s + (e.duration_secs ?? 0), 0)
  const si = cycleStatusIcon(cycle)
  const cost = isCC ? cycle.cc_cost : cycle.oc_cost
  const model = fmtModel(isCC ? cycle.cc_model : cycle.oc_model)

  const files = !isCC ? cycle.trace.files_changed.filter(f => !f.startsWith('+') && !f.startsWith('-')) : []
  const skills = !isCC ? cycle.trace.skills_used.filter(s =>
    ['simplify-lean','checkpoint','git','sdd','multi-agent'].some(k => s.includes(k))
  ) : []

  const hasEvents = isCC ? cycle.cc_events.length > 0 : cycle.oc_events.length > 0
  const statusIcon = hasEvents ? si.icon : '○'
  const statusColor = hasEvents ? si.color : DIM_COLOR

  return (
    <div
      onClick={onClick}
      style={{
        minWidth: 140, maxWidth: 180,
        background: BG_CARD,
        border: `2px solid ${isSelected ? color : '#30363d'}`,
        borderRadius: 8,
        padding: '8px 10px',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: statusColor, lineHeight: 1 }}>{statusIcon}</span>
        {action && <span style={{ fontSize: 10, fontWeight: 600, color: '#c9d1d9' }}>{actionLabel(action)}</span>}
        {dur > 0 && <span style={{ fontSize: 9, color: DIM_COLOR, marginLeft: 'auto' }}>{fmtDuration(dur)}</span>}
      </div>

      {(cost !== null || model) && (
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 3 }}>
          {cost !== null && <span style={{ fontSize: 9, color: `${color}cc`, fontWeight: 600 }}>${cost.toFixed(2)}</span>}
          {model && <span style={{ fontSize: 8, color: DIM_COLOR, fontFamily: 'monospace' }}>{model}</span>}
        </div>
      )}

      {files.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {files.slice(0, 2).map((f, i) => (
            <div key={i} style={{ fontSize: 8, color: '#8b949e', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 136 }}>
              {f.split('/').pop()}
            </div>
          ))}
          {files.length > 2 && <div style={{ fontSize: 8, color: `${DIM_COLOR}88` }}>+{files.length - 2} more</div>}
        </div>
      )}

      {skills.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 3 }}>
          {skills.slice(0, 2).map((s, i) => (
            <span key={i} style={{ fontSize: 7, background: `${OC_COLOR}18`, color: OC_COLOR, borderRadius: 3, padding: '1px 4px', fontFamily: 'monospace' }}>{s}</span>
          ))}
          {skills.length > 2 && <span style={{ fontSize: 7, color: DIM_COLOR }}>+{skills.length - 2}</span>}
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
  const [resolveText, setResolveText] = useState('')
  const [showResolveInput, setShowResolveInput] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  const fetchData = useCallback(() => {
    fetch('/api/orchestration/timeline')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const fetchRuns = useCallback(() => {
    fetch('/api/orchestration/runs')
      .then(r => r.ok ? r.json() : [])
      .then((rs: OrchRunSummary[]) => setRuns(rs))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchData()
    fetchRuns()
    pollRef.current = setInterval(fetchData, 3_000)
    return () => clearInterval(pollRef.current)
  }, [fetchData, fetchRuns])

  const handleRunSelect = useCallback((runKey: string) => {
    if (!runKey) {
      setSelectedRunKey(null)
      setHistoricalData(null)
      return
    }
    setSelectedRunKey(runKey)
    fetch(`/api/orchestration/runs/${runKey}`)
      .then(r => r.ok ? r.json() : null)
      .then((run) => {
        if (run?.snapshot_json) {
          try {
            setHistoricalData(JSON.parse(run.snapshot_json))
          } catch {
            setHistoricalData(null)
          }
        } else {
          setHistoricalData(null)
        }
      })
      .catch(() => setHistoricalData(null))
  }, [])

  const handleEmergencyStop = useCallback(() => {
    if (!window.confirm('Emergency stop — halt the orchestration?')) return
    setSubmitting(true)
    fetch('/api/orchestration/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'emergency_stop' }),
    })
      .then(() => { fetchData(); setSubmitting(false) })
      .catch(() => setSubmitting(false))
  }, [fetchData])

  const handleResolveDoubts = useCallback(() => {
    if (!resolveText.trim()) return
    setSubmitting(true)
    fetch('/api/orchestration/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolve_doubts', response: resolveText.trim() }),
    })
      .then(() => { setResolveText(''); setShowResolveInput(false); fetchData(); setSubmitting(false) })
      .catch(() => setSubmitting(false))
  }, [resolveText, fetchData])

  const displayData = (selectedRunKey ? historicalData : data) as OrchTimeline | null
  const isActiveView = !selectedRunKey

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b949e', fontSize: 13 }}>
        Loading orchestration data...
      </div>
    )
  }

  if (!data || data.status === 'none') {
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

  if (!displayData) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: '#8b949e' }}>
        <Workflow size={32} color="#21262d" />
        <div style={{ fontSize: 14, fontWeight: 600, color: '#c9d1d9' }}>No data available for this run</div>
        <div style={{ fontSize: 11, color: '#8b949e' }}>The historical run has no snapshot data. Select <b>Current run</b> to see the active orchestration.</div>
        <button
          onClick={() => { setSelectedRunKey(null); setHistoricalData(null) }}
          style={{ fontSize: 11, padding: '6px 14px', borderRadius: 6, background: BG_CARD, color: '#c9d1d9', border: `1px solid ${BORDER}`, cursor: 'pointer' }}
        >
          Back to current run
        </button>
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

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${BORDER}`, background: BG_DARK, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Workflow size={16} color={CC_COLOR} />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>{displayData?.project_name ?? '—'}</span>
          <StatusBadge status={displayData?.status ?? 'none'} />
          {displayData?.waiting_for_user && (
            <span style={{ fontSize: 10, color: WARN_COLOR, fontWeight: 600 }}><AlertTriangle size={10} style={{ display: 'inline' }} /> Waiting</span>
          )}

          {runs.length > 0 && (
            <select
              value={selectedRunKey ?? ''}
              onChange={e => handleRunSelect(e.target.value)}
              style={{
                fontSize: 10, padding: '3px 8px', borderRadius: 4, background: BG_CARD, color: '#c9d1d9',
                border: `1px solid ${BORDER}`, cursor: 'pointer', marginLeft: 4,
              }}
            >
              <option value="">Current run</option>
              {runs.map(run => (
                <option key={run.run_key} value={run.run_key}>
                  {run.project_name ?? 'run'} — {run.started_at.slice(0, 10)} ({run.total_cycles}c)
                </option>
              ))}
            </select>
          )}

          <div style={{ flex: 1 }} />
          {((displayData?.cc_total_cost ?? 0) > 0 || (displayData?.oc_total_cost ?? 0) > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9 }}>
              <Cpu size={9} color={CC_COLOR} />
              <span style={{ color: CC_COLOR, fontWeight: 600 }}>${(displayData?.cc_total_cost ?? 0).toFixed(2)}</span>
              <span style={{ color: DIM_COLOR }}>·</span>
              <Bot size={9} color={OC_COLOR} />
              <span style={{ color: OC_COLOR, fontWeight: 600 }}>${(displayData?.oc_total_cost ?? 0).toFixed(2)}</span>
              <span style={{ color: DIM_COLOR }}>= ${((displayData?.cc_total_cost ?? 0) + (displayData?.oc_total_cost ?? 0)).toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#7d8590' }}>
            {successCount > 0 && <span style={{ color: OC_COLOR }}>{successCount} ✓</span>}
            {failedCount > 0 && <span style={{ color: WARN_COLOR }}>{failedCount} !</span>}
            {errorCount > 0 && <span style={{ color: ERR_COLOR }}>{errorCount} ✗</span>}
            <span>{cycles.length} cycle{cycles.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div style={{ fontSize: 10, color: '#7d8590', marginTop: 3 }}>{displayData?.goal}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, fontSize: 10, color: '#484f58' }}>
          {displayData?.current_phase && <span style={{ color: '#c9d1d9' }}>{displayData.current_phase}</span>}
          {totalPhases > 0 && (
            <span style={{ color: '#c9d1d9', fontWeight: 600 }}>{completed}/{totalPhases} · {progressPct}%</span>
          )}
          {displayData?.phase_retry != null && displayData.phase_retry > 0 && <span style={{ color: WARN_COLOR }}>retry {displayData.phase_retry}</span>}
          <span style={{ marginLeft: 'auto' }}>{fmtElapsed(displayData?.started_at ?? null)}</span>
        </div>
        {totalPhases > 0 && (
          <div style={{ height: 3, background: BORDER, borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(progressPct, 100)}%`, height: '100%', background: hasErrors ? ERR_COLOR : progressPct >= 100 ? OC_COLOR : CC_COLOR, borderRadius: 2, transition: 'width 0.5s ease' }} />
          </div>
        )}
      </div>

      {isActiveView && data && (data.status === 'active' || data.status === 'paused') && (
        <div style={{ padding: '6px 16px', borderBottom: `1px solid ${BORDER}`, background: BG_DARK, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          <button
            onClick={handleEmergencyStop}
            disabled={submitting}
            style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 6, border: `1px solid ${ERR_COLOR}`,
              background: `${ERR_COLOR}15`, color: ERR_COLOR, cursor: submitting ? 'not-allowed' : 'pointer',
              fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <StopCircle size={12} /> Emergency Stop
          </button>
          {data.waiting_for_user && (
            <>
              <button
                onClick={() => setShowResolveInput(v => !v)}
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 6, border: `1px solid ${WARN_COLOR}`,
                  background: `${WARN_COLOR}15`, color: WARN_COLOR, cursor: 'pointer',
                  fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <MessageSquare size={12} /> Resolve Doubts
              </button>
              {showResolveInput && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 300px', minWidth: 200 }}>
                  <textarea
                    value={resolveText}
                    onChange={e => setResolveText(e.target.value)}
                    placeholder="Enter your response..."
                    rows={1}
                    style={{
                      fontSize: 11, padding: '4px 8px', borderRadius: 4, border: `1px solid ${BORDER}`,
                      background: BG_CARD, color: '#c9d1d9', flex: 1, resize: 'none', fontFamily: 'inherit',
                    }}
                  />
                  <button
                    onClick={handleResolveDoubts}
                    disabled={submitting || !resolveText.trim()}
                    style={{
                      fontSize: 11, padding: '4px 10px', borderRadius: 6,
                      border: `1px solid ${OC_COLOR}`, background: `${OC_COLOR}22`, color: OC_COLOR,
                      cursor: submitting || !resolveText.trim() ? 'not-allowed' : 'pointer', fontWeight: 600,
                    }}
                  >
                    Send
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: 16, minHeight: '100%' }}>
          {cycles.length === 0 ? (
            <div style={{ fontSize: 11, color: DIM_COLOR, textAlign: 'center', padding: 40 }}>
              No events recorded yet — start an orchestration to see the timeline.
            </div>
          ) : (
            <>
              <div ref={scrollRef} style={{ overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'thin' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `48px repeat(${cycles.length}, minmax(140px, 180px))`, gap: 6, minWidth: 48 + cycles.length * 146 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 4px' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: CC_COLOR, letterSpacing: '0.08em', writingMode: 'horizontal-tb' }}>CC</span>
                  </div>
                  {cycles.map((cycle, i) => (
                    <SwimLaneCell key={i} cycle={cycle} agent="cc" isSelected={selectedCycle === i} onClick={() => setSelectedCycle(selectedCycle === i ? null : i)} />
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 4px' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: OC_COLOR, letterSpacing: '0.08em' }}>OC</span>
                  </div>
                  {cycles.map((cycle, i) => (
                    <SwimLaneCell key={i} cycle={cycle} agent="oc" isSelected={selectedCycle === i} onClick={() => setSelectedCycle(selectedCycle === i ? null : i)} />
                  ))}
                </div>
              </div>
              {selectedCycle !== null && cycles[selectedCycle] && (
                <DetailPanel cycle={cycles[selectedCycle]} onClose={() => setSelectedCycle(null)} />
              )}
            </>
          )}
        </div>
      </div>

      <div style={{ padding: '4px 16px', borderTop: `1px solid ${BORDER}`, background: BG_DARK, display: 'flex', alignItems: 'center', gap: 12, fontSize: 9, color: '#484f58', flexShrink: 0 }}>
        <span>Verify:</span>
        <VerificationRow label="tsc" passed={displayData?.tsc_passed ?? null} errors={displayData?.tsc_errors} />
        <VerificationRow label="tests" passed={displayData?.tests_passed ?? null} errors={displayData?.tests_errors} />
        <span style={{ marginLeft: 'auto' }}>{isActiveView ? 'auto-refresh 3s' : 'historical view'}</span>
      </div>
    </div>
  )
}
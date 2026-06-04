import { useEffect, useState, useRef } from 'react'
import { Workflow, CheckCircle2, XCircle, AlertTriangle, Cpu, Bot, ChevronRight, Clock, X as XIcon, FileCode2, Sparkles, GitCommit } from 'lucide-react'
import type { OrchTimeline, OrchCycle, OrchCycleTrace } from '../types'

const CC_COLOR  = '#58a6ff'
const OC_COLOR  = '#3fb950'
const ERR_COLOR = '#f85149'
const WARN_COLOR = '#d29922'
const DIM_COLOR  = '#484f58'
const BG_DARK   = '#0d1117'
const BG_CARD   = '#161b22'
const BORDER    = '#21262d'

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

function NodeCard({ cycle, onClick, isSelected }: { cycle: OrchCycle; onClick: () => void; isSelected: boolean }) {
  const borderColor = cycleBorderColor(cycle)
  const statusIcon = cycleStatusIcon(cycle)
  const ccDur = cycle.cc_events.reduce((s, e) => s + (e.duration_secs ?? 0), 0)
  const ocDur = cycle.oc_events.reduce((s, e) => s + (e.duration_secs ?? 0), 0)
  const trace = cycle.trace
  const filesCount = trace.files_changed.filter(f => !f.startsWith('+') && !f.startsWith('-')).length

  return (
    <div
      onClick={onClick}
      style={{
        minWidth: 168, maxWidth: 210,
        background: BG_CARD,
        border: `2px solid ${isSelected ? CC_COLOR : borderColor}`,
        borderRadius: 10,
        padding: '10px 12px',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: DIM_COLOR, fontFamily: 'monospace' }}>#{cycle.index}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: statusIcon.color, lineHeight: 1 }}>{statusIcon.icon}</span>
      </div>

      <div style={{
        fontSize: 11, fontWeight: 600, color: '#e6edf3', lineHeight: 1.4, marginBottom: 6,
        overflow: 'hidden', textOverflow: 'ellipsis',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
      }}>
        {cycle.label}
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {cycle.cc_events.length > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 9, padding: '2px 6px', borderRadius: 4,
            background: `${CC_COLOR}15`, color: CC_COLOR, fontWeight: 600,
          }}>
            <Cpu size={9} /> {traceDetailLabel(trace) ?? actionLabel(cycle.cc_action ?? 'done')} · {fmtDuration(ccDur) || '—'}
          </span>
        )}
        {cycle.oc_events.length > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 9, padding: '2px 6px', borderRadius: 4,
            background: `${OC_COLOR}15`, color: OC_COLOR, fontWeight: 600,
          }}>
            <Bot size={9} /> {trace.git_commit ? trace.git_commit.slice(0, 7) : actionLabel(cycle.oc_action ?? 'done')} · {fmtDuration(ocDur) || '—'}
          </span>
        )}
      </div>

      {filesCount > 0 && (
        <div style={{ fontSize: 9, color: DIM_COLOR, marginTop: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
          <FileCode2 size={9} /> {filesCount} file{filesCount !== 1 ? 's' : ''}
        </div>
      )}

      {cycle.verified === false && (
        <div style={{ fontSize: 9, color: WARN_COLOR, marginTop: 3, fontWeight: 600 }}>verify FAILED</div>
      )}
      {cycle.verified === true && (
        <div style={{ fontSize: 9, color: OC_COLOR, marginTop: 3, fontWeight: 600 }}>verify OK</div>
      )}
      {trace.disagreements > 0 && (
        <div style={{ fontSize: 9, color: '#a371f7', marginTop: 2 }}>{trace.disagreements} disagree</div>
      )}
    </div>
  )
}

function ConnectorArrow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, padding: '0 2px' }}>
      <ChevronRight size={16} color={DIM_COLOR} />
    </div>
  )
}

function VerificationRow({ label, passed }: { label: string; passed: boolean | null }) {
  if (passed === null) return <span>{label} —</span>
  return passed
    ? <span style={{ color: OC_COLOR }}><CheckCircle2 size={8} style={{ display: 'inline' }} /> {label}</span>
    : <span style={{ color: ERR_COLOR }}><XCircle size={8} style={{ display: 'inline' }} /> {label}</span>
}

function DetailPanel({ cycle, onClose }: { cycle: OrchCycle; onClose: () => void }) {
  const trace = cycle.trace
  const ccDur = cycle.cc_events.reduce((s, e) => s + (e.duration_secs ?? 0), 0)
  const ocDur = cycle.oc_events.reduce((s, e) => s + (e.duration_secs ?? 0), 0)
  const actionDetailCC = traceDetailLabel(trace)

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
            {ccDur > 0 && <span style={{ fontSize: 9, color: DIM_COLOR, marginLeft: 'auto' }}>{fmtDuration(ccDur)}</span>}
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
            {ocDur > 0 && <span style={{ fontSize: 9, color: DIM_COLOR, marginLeft: 'auto' }}>{fmtDuration(ocDur)}</span>}
          </div>
          {(trace.git_commit || trace.files_changed.filter(f => !f.startsWith('+') && !f.startsWith('-')).length > 0 || trace.skills_used.length > 0) && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              {trace.git_commit && (
                <span style={{ fontSize: 9, color: `${OC_COLOR}99`, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <GitCommit size={9} /> {trace.git_commit.slice(0, 7)}
                </span>
              )}
              {trace.files_changed.filter(f => !f.startsWith('+') && !f.startsWith('-')).length > 0 && (
                <span style={{ fontSize: 9, color: `${OC_COLOR}99`, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <FileCode2 size={9} /> {trace.files_changed.filter(f => !f.startsWith('+') && !f.startsWith('-')).length} files
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
            <div style={{ fontSize: 10, color: DIM_COLOR }}>No OC events</div>
          ) : (
            cycle.oc_events.map((ev, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderTop: i > 0 ? `1px solid ${BORDER}` : 'none' }}>
                <span style={{ fontSize: 10, color: DIM_COLOR, fontFamily: 'monospace', minWidth: 40 }}>{ev.ts?.slice(0, 5)}</span>
                <span style={{ fontSize: 10, color: ev.action === 'error' || ev.action === 'timeout' ? ERR_COLOR : '#c9d1d9', wordBreak: 'break-word' }}>{ev.description}</span>
                {ev.duration_secs !== null && <span style={{ fontSize: 9, color: DIM_COLOR, marginLeft: 'auto' }}>{fmtDuration(ev.duration_secs)}</span>}
              </div>
            ))
          )}
          {cycle.verified !== null && (
            <div style={{ marginTop: 6, fontSize: 10, fontWeight: 600, color: cycle.verified ? OC_COLOR : ERR_COLOR, display: 'flex', alignItems: 'center', gap: 4 }}>
              {cycle.verified ? <><CheckCircle2 size={10} /> verify OK</> : <><XCircle size={10} /> verify FAILED</>}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
        {trace.verification && (
          <div style={{ fontSize: 9, color: DIM_COLOR }}>
            <VerificationRow label="tsc" passed={trace.verification.tsc_passed} /> · <VerificationRow label="tests" passed={trace.verification.tests_passed} />
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
            <FileCode2 size={9} /> Files changed ({trace.files_changed.filter(f => !f.startsWith('+') && !f.startsWith('-')).length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {trace.files_changed.filter(f => !f.startsWith('+') && !f.startsWith('-')).slice(0, 12).map((f, i) => (
              <span key={i} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#21262d', color: '#8b949e' }}>{f}</span>
            ))}
            {trace.files_changed.filter(f => !f.startsWith('+') && !f.startsWith('-')).length > 12 && (
              <span style={{ fontSize: 9, color: DIM_COLOR }}>+{trace.files_changed.filter(f => !f.startsWith('+') && !f.startsWith('-')).length - 12} more</span>
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

export function OrchestrateView() {
  const [data, setData] = useState<OrchTimeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedCycle, setSelectedCycle] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    function fetchData() {
      fetch('/api/orchestration/timeline')
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d) setData(d)
          setLoading(false)
        })
        .catch(() => setLoading(false))
    }
    fetchData()
    pollRef.current = setInterval(fetchData, 5_000)
    return () => clearInterval(pollRef.current)
  }, [])

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

  const cycles = data.cycles
  const hasErrors = cycles.some(c => c.status === 'error')
  const successCount = cycles.filter(c => c.status === 'success').length
  const failedCount = cycles.filter(c => c.status === 'verify_failed').length
  const errorCount = cycles.filter(c => c.status === 'error').length
  const progressPct = data.total_phases > 0 ? Math.round((data.completed / data.total_phases) * 100) : 0

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${BORDER}`, background: BG_DARK, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Workflow size={16} color={CC_COLOR} />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>{data.project_name ?? '—'}</span>
          <StatusBadge status={data.status} />
          {data.waiting_for_user && (
            <span style={{ fontSize: 10, color: WARN_COLOR, fontWeight: 600 }}><AlertTriangle size={10} style={{ display: 'inline' }} /> Waiting</span>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#7d8590' }}>
            {successCount > 0 && <span style={{ color: OC_COLOR }}>{successCount} ✓</span>}
            {failedCount > 0 && <span style={{ color: WARN_COLOR }}>{failedCount} !</span>}
            {errorCount > 0 && <span style={{ color: ERR_COLOR }}>{errorCount} ✗</span>}
            <span>{cycles.length} cycle{cycles.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div style={{ fontSize: 10, color: '#7d8590', marginTop: 3 }}>{data.goal}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, fontSize: 10, color: '#484f58' }}>
          {data.current_phase && <span style={{ color: '#c9d1d9' }}>{data.current_phase}</span>}
          {data.total_phases > 0 && (
            <span style={{ color: '#c9d1d9', fontWeight: 600 }}>{data.completed}/{data.total_phases} · {progressPct}%</span>
          )}
          {data.phase_retry > 0 && <span style={{ color: WARN_COLOR }}>retry {data.phase_retry}</span>}
          <span style={{ marginLeft: 'auto' }}>{fmtElapsed(data.started_at)}</span>
        </div>
        {data.total_phases > 0 && (
          <div style={{ height: 3, background: BORDER, borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(progressPct, 100)}%`, height: '100%', background: hasErrors ? ERR_COLOR : progressPct >= 100 ? OC_COLOR : CC_COLOR, borderRadius: 2, transition: 'width 0.5s ease' }} />
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: 16, minHeight: '100%' }}>
          {cycles.length === 0 ? (
            <div style={{ fontSize: 11, color: DIM_COLOR, textAlign: 'center', padding: 40 }}>
              No events recorded yet — start an orchestration to see the timeline.
            </div>
          ) : (
            <>
              <div ref={scrollRef} style={{ display: 'flex', alignItems: 'flex-start', gap: 0, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'thin' }}>
                {cycles.map((cycle, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', flexShrink: 0 }}>
                    {i > 0 && <ConnectorArrow />}
                    <NodeCard cycle={cycle} isSelected={selectedCycle === i} onClick={() => setSelectedCycle(selectedCycle === i ? null : i)} />
                  </div>
                ))}
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
        <VerificationRow label="tsc" passed={data.tsc_passed} />
        <VerificationRow label="tests" passed={data.tests_passed} />
        <span style={{ marginLeft: 'auto' }}>auto-refresh 5s</span>
      </div>
    </div>
  )
}
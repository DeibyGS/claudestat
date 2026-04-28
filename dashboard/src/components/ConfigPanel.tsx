import { useEffect, useState } from 'react'
import { Settings2, X, Save, TriangleAlert, CheckCircle2, Loader2, CalendarClock } from 'lucide-react'

type ReportFrequency = 'weekly' | 'biweekly' | 'monthly'

interface Config {
  killSwitchEnabled:   boolean
  killSwitchThreshold: number
  warnThresholds:      number[]
  plan:                'pro' | 'max5' | 'max20' | null
  reportsEnabled:      boolean
  reportFrequency:     ReportFrequency
  reportDay:           number
  reportTime:          string
}

interface Props { onClose: () => void }

const DAY_OPTIONS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

const FREQ_OPTIONS: { value: ReportFrequency; label: string }[] = [
  { value: 'weekly',   label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly',  label: 'Monthly' },
]

const PLAN_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto',  label: 'Auto-detect' },
  { value: 'pro',   label: 'Pro' },
  { value: 'max5',  label: 'Max 5×' },
  { value: 'max20', label: 'Max 20×' },
]

function isValidPct(v: number) { return Number.isFinite(v) && v >= 1 && v <= 100 }

export function ConfigPanel({ onClose }: Props) {
  const [cfg,        setCfg]        = useState<Config | null>(null)
  const [status,     setStatus]     = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error,      setError]      = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/config')
      .then(r => r.json())
      .then(setCfg)
      .catch(() => setError('Could not connect to daemon'))
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function save() {
    if (!cfg || Object.keys(fieldErrors).length > 0) return
    setStatus('saving')
    try {
      const r = await fetch('/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      if (!r.ok) throw new Error('Error saving')
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2000)
    } catch {
      setStatus('error')
    }
  }

  function update<K extends keyof Config>(key: K, value: Config[K]) {
    setCfg(prev => prev ? { ...prev, [key]: value } : prev)
    setStatus('idle')
  }

  function updateThreshold(index: number, value: number) {
    if (!cfg) return
    const next = [...cfg.warnThresholds]
    next[index] = value
    const key = `threshold_${index}`
    if (!isValidPct(value)) {
      setFieldErrors(prev => ({ ...prev, [key]: 'Must be 1–100' }))
    } else {
      setFieldErrors(prev => { const e = { ...prev }; delete e[key]; return e })
    }
    update('warnThresholds', next)
  }

  function updateKillSwitchThreshold(value: number) {
    if (!isValidPct(value)) {
      setFieldErrors(prev => ({ ...prev, killSwitch: 'Debe ser 1–100' }))
    } else {
      setFieldErrors(prev => { const e = { ...prev }; delete e.killSwitch; return e })
    }
    update('killSwitchThreshold', value)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: '#00000080',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderLeft: '3px solid #8b949e',
          borderRadius: 10,
          width: '100%', maxWidth: 480,
          boxShadow: '0 8px 32px #00000088',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid #21262d',
        }}>
          <Settings2 size={15} color="#8b949e" />
          <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 14 }}>
            Settings
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6e7681', display: 'flex' }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              color: '#f85149', fontSize: 12,
              background: '#f8514915', border: '1px solid #f8514930',
              borderRadius: 6, padding: '8px 12px',
            }}>
              <TriangleAlert size={13} /> {error}
            </div>
          )}

          {!cfg ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0', color: '#6e7681', gap: 8 }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              Loading settings…
            </div>
          ) : (
            <>
              {/* Plan */}
              <Section label="Claude Code plan" hint="Affects calculated quota limits">
                <select
                  value={cfg.plan ?? 'auto'}
                  onChange={e => update('plan', e.target.value === 'auto' ? null : e.target.value as Config['plan'])}
                  style={selectStyle}
                >
                  {PLAN_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {cfg.plan === null && (
                  <div style={{ marginTop: 6, fontSize: 10, color: '#484f58', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: '#3fb950', fontWeight: 700 }}>●</span>
                    Auto: reading plan from macOS keychain
                  </div>
                )}
              </Section>

              {/* Kill switch */}
              <Section label="Kill Switch" hint="Blocks tool calls when threshold is exceeded">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Toggle
                    value={cfg.killSwitchEnabled}
                    onChange={v => update('killSwitchEnabled', v)}
                  />
                  <span style={{ color: '#8b949e', fontSize: 11 }}>
                    {cfg.killSwitchEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>

                {cfg.killSwitchEnabled && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                    <span style={{ color: '#7d8590', fontSize: 11, minWidth: 80 }}>
                      Block at
                    </span>
                    <input
                      type="number" min={1} max={100}
                      value={cfg.killSwitchThreshold}
                      onChange={e => updateKillSwitchThreshold(Number(e.target.value))}
                      style={{ ...inputStyle, width: 64, borderColor: fieldErrors.killSwitch ? '#f85149' : undefined }}
                    />
                    {fieldErrors.killSwitch && <span style={{ color: '#f85149', fontSize: 10 }}>{fieldErrors.killSwitch}</span>}
                    <span style={{ color: '#7d8590', fontSize: 11 }}>% of quota</span>
                  </div>
                )}
              </Section>

              {/* Thresholds de warning */}
              <Section label="Alert levels" hint="% of quota at which each warning level is triggered">
                {[
                  { label: 'Yellow', color: '#d29922', index: 0 },
                  { label: 'Orange', color: '#f0883e', index: 1 },
                  { label: 'Red',    color: '#f85149', index: 2 },
                ].map(({ label, color, index }) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: color, flexShrink: 0,
                    }} />
                    <span style={{ color: '#7d8590', fontSize: 11, minWidth: 56 }}>{label}</span>
                    <input
                      type="number" min={1} max={100}
                      value={cfg.warnThresholds[index] ?? ''}
                      onChange={e => updateThreshold(index, Number(e.target.value))}
                      style={{ ...inputStyle, width: 64, borderColor: fieldErrors[`threshold_${index}`] ? '#f85149' : undefined }}
                    />
                    <span style={{ color: '#7d8590', fontSize: 11 }}>%</span>
                    {fieldErrors[`threshold_${index}`] && (
                      <span style={{ color: '#f85149', fontSize: 10 }}>{fieldErrors[`threshold_${index}`]}</span>
                    )}
                  </div>
                ))}
              </Section>

              {/* Informes automáticos */}
              <Section
                label="Automatic reports"
                hint="Generates a usage report at the configured interval"
                icon={<CalendarClock size={13} color="#8b949e" />}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <Toggle
                    value={cfg.reportsEnabled}
                    onChange={v => update('reportsEnabled', v)}
                  />
                  <span style={{ color: '#8b949e', fontSize: 11 }}>
                    {cfg.reportsEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>

                {cfg.reportsEnabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Frecuencia */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ color: '#7d8590', fontSize: 11, minWidth: 70 }}>Frequency</span>
                      <select
                        value={cfg.reportFrequency}
                        onChange={e => update('reportFrequency', e.target.value as ReportFrequency)}
                        style={{ ...selectStyle, width: 'auto', flex: 1 }}
                      >
                        {FREQ_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Día */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ color: '#7d8590', fontSize: 11, minWidth: 70 }}>Day</span>
                      <select
                        value={cfg.reportDay}
                        onChange={e => update('reportDay', Number(e.target.value))}
                        style={{ ...selectStyle, width: 'auto', flex: 1 }}
                      >
                        {DAY_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Hora */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ color: '#7d8590', fontSize: 11, minWidth: 70 }}>Time</span>
                      <input
                        type="time"
                        value={cfg.reportTime}
                        onChange={e => update('reportTime', e.target.value)}
                        style={{ ...inputStyle, width: 'auto', flex: 1 }}
                      />
                    </div>
                  </div>
                )}
              </Section>
            </>
          )}
        </div>

        {/* Footer */}
        {cfg && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
            padding: '10px 16px',
            borderTop: '1px solid #21262d',
          }}>
            {status === 'saved' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#3fb950', fontSize: 12 }}>
                <CheckCircle2 size={13} /> Saved
              </span>
            )}
            {status === 'error' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#f85149', fontSize: 12 }}>
                <TriangleAlert size={13} /> Error saving
              </span>
            )}
            <button
              onClick={onClose}
              style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 12,
                background: 'transparent', border: '1px solid #30363d',
                color: '#8b949e', cursor: 'pointer',
              }}
            >
              Close
            </button>
            <button
              onClick={save}
              disabled={status === 'saving'}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: '#1f6feb', border: '1px solid #388bfd40',
                color: '#e6edf3', cursor: status === 'saving' ? 'default' : 'pointer',
                opacity: status === 'saving' ? 0.7 : 1,
              }}
            >
              {status === 'saving'
                ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
                : <><Save size={12} /> Save</>
              }
            </button>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function Section({ label, hint, icon, children }: { label: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ color: '#e6edf3', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          {icon}{label}
        </div>
        {hint && <div style={{ color: '#484f58', fontSize: 11, marginTop: 2 }}>{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 36, height: 20, borderRadius: 10,
        background: value ? '#1f6feb' : '#30363d',
        position: 'relative', cursor: 'pointer',
        transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute',
        top: 3, left: value ? 19 : 3,
        width: 14, height: 14, borderRadius: '50%',
        background: '#e6edf3',
        transition: 'left 0.2s',
      }} />
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 5,
  padding: '4px 8px',
  color: '#e6edf3',
  fontSize: 12,
  outline: 'none',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: '100%',
  cursor: 'pointer',
}

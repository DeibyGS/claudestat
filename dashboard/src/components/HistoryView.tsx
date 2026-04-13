import type { DaySessions } from '../types'
import { SessionCard } from './SessionCard'

interface Props { days: DaySessions[]; activeSessionId?: string }

function fmtDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  if (dateStr === today)     return 'Hoy'
  if (dateStr === yesterday) return 'Ayer'
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
}
function fmtDuration(ms: number) {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

const S = {
  wrap:    { padding: '16px 24px', overflowY: 'auto' as const, height: '100%' },
  dayWrap: { marginBottom: 28 },
  dayHead: {
    display: 'flex', alignItems: 'center', gap: 16,
    marginBottom: 10, paddingBottom: 6,
    borderBottom: '1px solid #21262d',
  },
  dayLabel: { color: '#e6edf3', fontWeight: 700, fontSize: 14 },
  dayStat:  { color: '#7d8590', fontSize: 11 },
  badge: (color: string): React.CSSProperties => ({
    color, background: color + '18', border: `1px solid ${color}30`,
    borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 600,
  }),
  sessions: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  empty: {
    padding: '60px 24px', color: '#7d8590', textAlign: 'center' as const,
    fontSize: 13,
  },
}

export function HistoryView({ days, activeSessionId }: Props) {
  if (days.length === 0) {
    return (
      <div style={S.empty}>
        No hay sesiones registradas todavía.<br />
        <span style={{ fontSize: 11 }}>
          Las sesiones aparecen aquí una vez que el daemon las procesa.
        </span>
      </div>
    )
  }

  return (
    <div style={S.wrap}>
      {days.map(day => (
        <div key={day.date} style={S.dayWrap}>
          {/* Cabecera del día */}
          <div style={S.dayHead}>
            <span style={S.dayLabel}>{fmtDate(day.date)}</span>
            <span style={S.dayStat}>{day.sessions.length} sesión{day.sessions.length > 1 ? 'es' : ''}</span>
            <span style={S.dayStat}>·</span>
            <span style={S.dayStat}>{fmtDuration(day.total_duration_ms)}</span>
            <span style={S.dayStat}>·</span>
            <span style={S.badge('#3fb950')}>${day.total_cost.toFixed(3)}</span>
            <span style={S.dayStat}>·</span>
            <span style={S.dayStat}>{fmtTok(day.total_tokens)} tokens</span>
          </div>

          {/* Sesiones del día */}
          <div style={S.sessions}>
            {day.sessions.map(session => (
              <SessionCard
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

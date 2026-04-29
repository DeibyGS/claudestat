import { AlertTriangle, Shield } from 'lucide-react'
import type { QuotaData, CostInfo, TraceEvent, ClaudeStatsData } from '../../types'
import { generateTips, type SessionPrompt } from './utils'
import { StatusCard } from './cards/StatusCard'
import { Card, CardHeader } from './cards/StatusCard'
import { ModelCard } from './cards/ModelCard'
import { ActivityCard, DailyActivityCard, ProjectionCard } from './cards/ActivityCard'
import { CacheCard, LoopsCard } from './cards/CacheCard'
import { CoachPanel } from './CoachPanel'

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  quota?:       QuotaData
  cost?:        CostInfo
  events?:      TraceEvent[]
  prompts?:     SessionPrompt[]
  claudeStats?: ClaudeStatsData
}

// ─── Main component ────────────────────────────────────────────────────────────

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

/**
 * claude-stats.ts — Lee ~/.claude/stats-cache.json
 *
 * Claude Code mantiene este archivo con actividad agregada por día:
 * - messageCount: total de mensajes (human + assistant) — ≈ 2× prompts reales
 * - sessionCount: sesiones abiertas
 * - toolCallCount: llamadas a herramientas
 * - tokensByModel: tokens de OUTPUT por modelo (lo que genera Claude)
 *
 * NOTA: lastComputedDate indica hasta qué fecha están los datos. El día actual
 * puede no aparecer todavía si Claude Code aún no actualizó el cache.
 */

import fs   from 'fs'
import path from 'path'
import os   from 'os'

const STATS_PATH = path.join(os.homedir(), '.claude', 'stats-cache.json')

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface DayActivity {
  date:         string
  messages:     number   // human + assistant (÷2 ≈ prompts reales)
  sessions:     number
  tools:        number
  outputTokens: number   // tokens generados por Claude (output)
}

export interface ClaudeStatsData {
  today:        DayActivity | null    // día más reciente disponible (hoy, ayer, o último en cache)
  yesterday:    DayActivity | null
  last7:        DayActivity           // suma de los últimos 7 días
  allTime: {
    sessions: number
    messages: number
  }
  cacheDate:    string | null         // lastComputedDate del archivo
  todayLabel:   string | null         // 'Hoy', 'Ayer', o fecha ISO si el cache está desactualizado
  cacheIsStale: boolean               // true si el cache no tiene datos de hoy ni de ayer
}

// ─── Lectura ──────────────────────────────────────────────────────────────────

export function readClaudeStats(): ClaudeStatsData {
  const empty: ClaudeStatsData = {
    today: null, yesterday: null,
    last7: { date: 'last7', messages: 0, sessions: 0, tools: 0, outputTokens: 0 },
    allTime: { sessions: 0, messages: 0 },
    cacheDate: null, todayLabel: null, cacheIsStale: false,
  }

  try {
    const raw  = fs.readFileSync(STATS_PATH, 'utf8')
    const data = JSON.parse(raw)

    // Fechas de referencia
    const now       = new Date()
    const todayStr  = now.toISOString().slice(0, 10)
    const yest      = new Date(now.getTime() - 86_400_000)
    const yestStr   = yest.toISOString().slice(0, 10)
    const cutoffStr = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)

    // Índice de tokens por fecha
    const tokensByDate: Record<string, Record<string, number>> = {}
    for (const entry of (data.dailyModelTokens ?? [])) {
      tokensByDate[entry.date] = entry.tokensByModel ?? {}
    }

    // Suma de tokens por fecha
    function tokensForDate(d: string): number {
      const byModel = tokensByDate[d] ?? {}
      return Object.values(byModel).reduce((a, b) => a + (b as number), 0)
    }

    // Construir DayActivity por fecha
    const actByDate: Record<string, DayActivity> = {}
    for (const a of (data.dailyActivity ?? [])) {
      actByDate[a.date] = {
        date: a.date, messages: a.messageCount ?? 0,
        sessions: a.sessionCount ?? 0, tools: a.toolCallCount ?? 0,
        outputTokens: tokensForDate(a.date),
      }
    }

    // Last 7 days aggregate
    const last7: DayActivity = { date: 'last7', messages: 0, sessions: 0, tools: 0, outputTokens: 0 }
    for (const [date, act] of Object.entries(actByDate)) {
      if (date >= cutoffStr) {
        last7.messages     += act.messages
        last7.sessions     += act.sessions
        last7.tools        += act.tools
        last7.outputTokens += act.outputTokens
      }
    }

    // Si hoy/ayer no están en el cache, usar el día más reciente disponible
    const todayData = actByDate[todayStr] ?? null
    const yesterdayData = actByDate[yestStr] ?? null
    let mostRecentDay: DayActivity | null = todayData ?? yesterdayData
    let mostRecentLabel: string | null = todayData ? 'Hoy' : yesterdayData ? 'Ayer' : null

    if (!mostRecentDay) {
      // Cache antiguo — buscar el día más reciente disponible
      const sortedDates = Object.keys(actByDate).sort().reverse()
      if (sortedDates.length > 0) {
        mostRecentDay   = actByDate[sortedDates[0]]
        mostRecentLabel = sortedDates[0]   // ej. "2026-04-16"
      }
    }

    return {
      today:     mostRecentDay,
      yesterday: yesterdayData,
      last7,
      allTime: {
        sessions: data.totalSessions ?? 0,
        messages: data.totalMessages ?? 0,
      },
      cacheDate:        data.lastComputedDate ?? null,
      todayLabel:       mostRecentLabel,
      cacheIsStale:     !todayData && !yesterdayData,
    }
  } catch {
    return empty
  }
}

/**
 * weekly.ts — Tokens semanales desde stats-cache.json de Claude Code
 * No necesita daemon ni API — lee el archivo directamente.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

const STATS_PATH = path.join(os.homedir(), '.claude', 'stats-cache.json')

export interface WeeklyStats {
  totalTokens: number
  byDay: { date: string; tokens: number }[]
  lastUpdated: string | null
}

export function readWeeklyStats(): WeeklyStats {
  try {
    const raw  = fs.readFileSync(STATS_PATH, 'utf8')
    const data = JSON.parse(raw)

    const today   = new Date()
    const cutoff  = new Date(today)
    cutoff.setDate(today.getDate() - 6)  // últimos 7 días

    const byDay: { date: string; tokens: number }[] = []

    for (const entry of (data.dailyModelTokens || [])) {
      const date = new Date(entry.date)
      if (date < cutoff) continue

      const tokens = Object.values(entry.tokensByModel as Record<string, number>)
        .reduce((sum, n) => sum + n, 0)

      byDay.push({ date: entry.date, tokens })
    }

    byDay.sort((a, b) => a.date.localeCompare(b.date))

    return {
      totalTokens:  byDay.reduce((s, d) => s + d.tokens, 0),
      byDay,
      lastUpdated:  data.lastComputedDate ?? null
    }
  } catch {
    return { totalTokens: 0, byDay: [], lastUpdated: null }
  }
}

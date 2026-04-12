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

    const byDay: { date: string; tokens: number }[] = []

    // Tomar los últimos 7 días disponibles (sin filtrar por fecha actual,
    // porque stats-cache.json puede estar desactualizado por días/semanas)
    const allEntries = (data.dailyModelTokens || [])
      .map((entry: any) => ({
        date:   entry.date as string,
        tokens: Object.values(entry.tokensByModel as Record<string, number>)
                  .reduce((sum, n) => sum + n, 0)
      }))
      .sort((a: any, b: any) => a.date.localeCompare(b.date))

    byDay.push(...allEntries.slice(-7))

    return {
      totalTokens:  byDay.reduce((s, d) => s + d.tokens, 0),
      byDay,
      lastUpdated:  data.lastComputedDate ?? null
    }
  } catch {
    return { totalTokens: 0, byDay: [], lastUpdated: null }
  }
}

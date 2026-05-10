import fs from 'fs'
import os from 'os'
import path from 'path'
import { dbOps, type SessionRow } from './db'

export interface ExportOpts {
  format:  'json' | 'csv'
  from?:   string
  to?:     string
  project?: string
  output?: string
}

function parseDate(str: string, endOfDay = false): number {
  const ms = Date.parse(str)
  if (isNaN(ms)) throw new Error(`Invalid date: "${str}" — expected YYYY-MM-DD`)
  return endOfDay ? ms + 86_399_999 : ms
}

function csvField(value: unknown): string {
  const s = value == null ? '' : String(value)
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

const CSV_HEADERS = [
  'id', 'started_at', 'cwd', 'project_path',
  'total_cost_usd', 'total_input_tokens', 'total_output_tokens',
  'efficiency_score', 'loops_detected',
]

function toRow(s: SessionRow): Record<string, unknown> {
  return {
    id: s.id,
    started_at: new Date(s.started_at).toISOString(),
    cwd: s.cwd ?? '',
    project_path: s.project_path ?? '',
    total_cost_usd: s.total_cost_usd ?? 0,
    total_input_tokens: s.total_input_tokens ?? 0,
    total_output_tokens: s.total_output_tokens ?? 0,
    efficiency_score: s.efficiency_score ?? 100,
    loops_detected: s.loops_detected ?? 0,
  }
}

export function runExport(opts: ExportOpts): void {
  let fromMs: number | undefined
  let toMs:   number | undefined

  try {
    if (opts.from) fromMs = parseDate(opts.from)
    if (opts.to)   toMs   = parseDate(opts.to, true)
  } catch (err: any) {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  }

  const sessions = dbOps.getAllSessions().filter(s => {
    if (fromMs !== undefined && s.started_at < fromMs) return false
    if (toMs   !== undefined && s.started_at > toMs)   return false
    if (opts.project) {
      if (!s.project_path) return false
      if (!s.project_path.toLowerCase().includes(opts.project.toLowerCase())) return false
    }
    return true
  })

  const rows = sessions.map(toRow)
  let output: string

  if (opts.format === 'csv') {
    const lines = [
      CSV_HEADERS.join(','),
      ...rows.map(r => CSV_HEADERS.map(h => csvField(r[h])).join(',')),
    ]
    output = lines.join('\n') + '\n'
  } else {
    output = JSON.stringify(rows, null, 2) + '\n'
  }

  const date = new Date().toISOString().slice(0, 10)
  const dest = path.resolve(opts.output ?? path.join(os.homedir(), 'Downloads', `claudestat-export-${date}.${opts.format}`))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, output)
  console.log(`✓ Exported ${rows.length} session(s) → ${dest}`)
}

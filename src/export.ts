import fs from 'fs'
import path from 'path'
import { dbOps, type SessionRow } from './db'

export interface ExportOpts {
  format:  'json' | 'csv' | 'markdown'
  from?:   string
  to?:     string
  since?:  string   // NUEVO: "7d", "30d", etc.
  project?: string
  output?: string   // si undefined → stdout
}

const MD_HEADERS = ['Date', 'Project', 'Cost (USD)', 'Input tokens', 'Output tokens', 'Efficiency', 'Loops']

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

function parseSince(since: string): number {
  const match = since.match(/^(\d+)d$/)
  if (!match) throw new Error(`Invalid --since format: "${since}" — use e.g. "7d" or "30d"`)
  return Date.now() - parseInt(match[1], 10) * 86_400_000
}

function toMarkdownRow(r: Record<string, unknown>): string {
  return [
    String(r.started_at).slice(0, 10),
    r.project_path ? String(r.project_path).split('/').pop() ?? '—' : '—',
    `$${Number(r.total_cost_usd).toFixed(4)}`,
    String(r.total_input_tokens),
    String(r.total_output_tokens),
    `${r.efficiency_score}/100`,
    String(r.loops_detected),
  ].map(v => v.replace(/\|/g, '\\|')).join(' | ')
}

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
    if (opts.since && !opts.from) {
      const sinceMs = parseSince(opts.since)
      opts.from = new Date(sinceMs).toISOString().slice(0, 10)
    }
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
  } else if (opts.format === 'markdown') {
    const separator = MD_HEADERS.map(() => '---').join(' | ')
    const lines = [
      MD_HEADERS.join(' | '),
      separator,
      ...rows.map(toMarkdownRow),
    ]
    output = lines.join('\n') + '\n'
  } else {
    output = JSON.stringify(rows, null, 2) + '\n'
  }

  if (!opts.output) {
    process.stdout.write(output)
    console.error(`✓ Exported ${rows.length} session(s)`)   // stderr para no contaminar stdout
  } else {
    const dest = path.resolve(opts.output)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, output)
    console.log(`✓ Exported ${rows.length} session(s) → ${dest}`)
  }
}

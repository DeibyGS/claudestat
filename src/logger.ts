import fs   from 'fs'
import { getDaemonLogFile, getClaudestatDir } from './paths'
import { readConfig } from './config'

const LEVEL_RANK: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const MAX_SIZE_BYTES = 10 * 1024 * 1024
const MAX_FILES      = 3

function rotate(logFile: string): void {
  for (let i = MAX_FILES - 2; i >= 0; i--) {
    const src = i === 0 ? logFile : `${logFile}.${i}`
    const dst = `${logFile}.${i + 1}`
    try {
      if (fs.existsSync(src)) fs.renameSync(src, dst)
    } catch {}
  }
}

function write(level: string, message: string): void {
  try {
    const cfg       = readConfig()
    const minRank   = LEVEL_RANK[cfg.logLevel] ?? 1
    if ((LEVEL_RANK[level] ?? 0) < minRank) return

    const logFile   = getDaemonLogFile()
    fs.mkdirSync(getClaudestatDir(), { recursive: true })

    try {
      const stat = fs.statSync(logFile)
      if (stat.size >= MAX_SIZE_BYTES) rotate(logFile)
    } catch {}

    const ts   = new Date().toISOString()
    const line = `${ts} [${level.toUpperCase()}] ${message}\n`
    fs.appendFileSync(logFile, line)
  } catch {}
}

export const logger = {
  debug: (msg: string) => write('debug', msg),
  info:  (msg: string) => write('info',  msg),
  warn:  (msg: string) => write('warn',  msg),
  error: (msg: string) => write('error', msg),
}

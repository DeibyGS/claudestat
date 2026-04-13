/**
 * project-scanner.ts — Descubrimiento de proyectos desde ~/.claude/projects/
 *
 * Escanea los directorios de Claude Code, decodifica sus paths reales,
 * lee los HANDOFF.md y extrae métricas de progreso.
 */

import fs   from 'fs'
import path from 'path'
import os   from 'os'

export interface HandoffProgress {
  done:     number
  total:    number
  pct:      number
  nextTask: string | null   // primera tarea [ ] pendiente
}

export interface ProjectScanResult {
  path:         string         // path real del proyecto
  name:         string         // último segmento del path
  encodedDir:   string         // nombre del directorio en ~/.claude/projects
  hasHandoff:   boolean
  progress:     HandoffProgress
}

// ─── Decode ───────────────────────────────────────────────────────────────────

/**
 * Decodifica el nombre de directorio de Claude Code al path real.
 * "-Users-db-Documents-GitHub-claudetrace" → "/Users/db/Documents/GitHub/claudetrace"
 *
 * Ancla en el home dir para reducir ambigüedad con carpetas que contienen '-'.
 */
export function decodeProjectDir(encodedName: string): string | null {
  const homeDir     = os.homedir()
  const encodedHome = homeDir.replace(/\//g, '-')   // "/Users/db" → "-Users-db"

  if (!encodedName.startsWith(encodedHome)) return null

  const rest = encodedName.slice(encodedHome.length)  // "-Documents-GitHub-claudetrace"
  const decoded = homeDir + rest.replace(/-/g, '/')   // "/Users/db/Documents/GitHub/claudetrace"

  // Filtrar: no incluir el home dir en sí (no es un proyecto)
  if (decoded === homeDir) return null

  return decoded
}

// ─── HANDOFF parser ───────────────────────────────────────────────────────────

export function parseHandoffProgress(content: string): HandoffProgress {
  const doneMatches    = content.match(/- \[x\]/gi) || []
  const pendingMatches = content.match(/- \[ \]/g)  || []
  const done  = doneMatches.length
  const total = done + pendingMatches.length
  const pct   = total > 0 ? Math.round(done / total * 100) : 0

  // Primera tarea pendiente
  let nextTask: string | null = null
  const lines = content.split('\n')
  for (const line of lines) {
    const m = line.match(/^[\s]*- \[ \]\s*(.+)$/)
    if (m) { nextTask = m[1].trim().replace(/^\*\*/, '').replace(/\*\*$/, ''); break }
  }

  return { done, total, pct, nextTask }
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

export function discoverProjects(): ProjectScanResult[] {
  const results: ProjectScanResult[] = []

  let dirs: string[]
  try { dirs = fs.readdirSync(PROJECTS_DIR) } catch { return [] }

  for (const encodedDir of dirs) {
    const dirPath = path.join(PROJECTS_DIR, encodedDir)
    try {
      if (!fs.statSync(dirPath).isDirectory()) continue
    } catch { continue }

    const realPath = decodeProjectDir(encodedDir)
    if (!realPath) continue                         // home dir o no decodificable

    // Solo incluir si el directorio existe en disco
    if (!fs.existsSync(realPath)) continue

    const handoffPath = path.join(realPath, 'HANDOFF.md')
    const hasHandoff  = fs.existsSync(handoffPath)
    const progress    = hasHandoff
      ? parseHandoffProgress(fs.readFileSync(handoffPath, 'utf8'))
      : { done: 0, total: 0, pct: 0, nextTask: null }

    results.push({
      path:       realPath,
      name:       path.basename(realPath),
      encodedDir,
      hasHandoff,
      progress,
    })
  }

  return results
}

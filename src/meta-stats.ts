/**
 * meta-stats.ts — KPIs de contexto: HANDOFF, Engram, configuración y alertas
 *
 * Lee archivos del sistema de ficheros y estima tokens (chars / 4).
 * Mantiene un historial en memoria para sparklines (últimos 30 puntos).
 */

import fs   from 'fs'
import path from 'path'
import os   from 'os'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface MetaAlert {
  level:   'info' | 'warning' | 'critical'
  message: string
  metric:  string
}

export interface MetaStats {
  ts:               number
  handoffTokens:    number   // tokens estimados en HANDOFF.md de la sesión activa
  engramTokens:     number   // tokens estimados en archivos de memoria
  engramFileCount:  number
  configTokens:     number   // settings.json + CLAUDE.md (global + proyecto)
  alerts:           MetaAlert[]
}

export interface MetaSnapshot {
  ts:            number
  handoffTokens: number
  engramTokens:  number
  configTokens:  number
}

// ─── Historial en memoria ─────────────────────────────────────────────────────

const MAX_HISTORY = 30
const history: MetaSnapshot[] = []

// ─── Helpers ──────────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function readFile(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf8') } catch { return '' }
}

function readDirTokens(dirPath: string): { tokens: number; files: number } {
  let tokens = 0; let files = 0
  try {
    for (const entry of fs.readdirSync(dirPath)) {
      try {
        const full = path.join(dirPath, entry)
        if (fs.statSync(full).isFile()) {
          tokens += estimateTokens(fs.readFileSync(full, 'utf8'))
          files++
        }
      } catch { /* archivo inaccesible */ }
    }
  } catch { /* directorio no encontrado */ }
  return { tokens, files }
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

// ─── Compute ──────────────────────────────────────────────────────────────────

export function computeMetaStats(sessionCwd?: string, contextPct?: number): MetaStats {
  const ts = Date.now()

  // ── HANDOFF.md del proyecto activo ────────────────────────────────────────
  let handoffTokens = 0
  if (sessionCwd) {
    const hp = path.join(sessionCwd, 'HANDOFF.md')
    const content = readFile(hp)
    if (content) handoffTokens = estimateTokens(content)
  }

  // ── Archivos de memoria Engram ────────────────────────────────────────────
  // Ruta derivada: /Users/db → -Users-db (cada '/' se reemplaza por '-')
  const homeForPath = os.homedir().replace(/\//g, '-')
  const MEMORY_DIR  = path.join(os.homedir(), '.claude', 'projects', homeForPath, 'memory')
  const { tokens: engramTokens, files: engramFileCount } = readDirTokens(MEMORY_DIR)

  // ── Archivos de configuración ─────────────────────────────────────────────
  let configTokens = 0
  const configFiles = [
    path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(os.homedir(), '.claude', 'CLAUDE.md'),
  ]
  // CLAUDE.md y AGENTS.md del proyecto activo (si existen)
  if (sessionCwd) {
    configFiles.push(
      path.join(sessionCwd, 'CLAUDE.md'),
      path.join(sessionCwd, 'AGENTS.md'),
    )
  }
  for (const f of configFiles) {
    const content = readFile(f)
    if (content) configTokens += estimateTokens(content)
  }

  // ── Alertas ───────────────────────────────────────────────────────────────
  const alerts: MetaAlert[] = []

  if (handoffTokens > 5_000) {
    alerts.push({
      level: 'critical',
      message: `HANDOFF.md muy largo (${fmtTok(handoffTokens)} tokens) — nueva sesión perderá contexto`,
      metric: 'handoff',
    })
  } else if (handoffTokens > 2_500) {
    alerts.push({
      level: 'warning',
      message: `HANDOFF.md largo (${fmtTok(handoffTokens)} tokens) — considera resumirlo`,
      metric: 'handoff',
    })
  }

  const ENGRAM_LIMIT = 1_000_000
  if (engramTokens > ENGRAM_LIMIT * 0.8) {
    alerts.push({
      level: 'warning',
      message: `Memorias Engram al ${Math.round(engramTokens / ENGRAM_LIMIT * 100)}% del límite estimado`,
      metric: 'engram',
    })
  }

  if (contextPct !== undefined) {
    if (contextPct > 90) {
      alerts.push({ level: 'critical', message: `Auto-compact inminente — solo ${100 - contextPct}% restante`, metric: 'context' })
    } else if (contextPct > 75) {
      alerts.push({ level: 'warning', message: `Contexto al ${contextPct}% — auto-compact pronto`, metric: 'context' })
    }
  }

  // ── Historial ─────────────────────────────────────────────────────────────
  history.push({ ts, handoffTokens, engramTokens, configTokens })
  if (history.length > MAX_HISTORY) history.shift()

  return { ts, handoffTokens, engramTokens, engramFileCount, configTokens, alerts }
}

export function getMetaHistory(): MetaSnapshot[] {
  return [...history]
}

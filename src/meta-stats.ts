/**
 * meta-stats.ts — Context overhead KPIs
 *
 * Detects files that Claude Code loads into context automatically
 * (CLAUDE.md, settings, AGENTS.md, etc.) and estimates their token cost.
 * Keeps a rolling history for sparklines (last 30 snapshots).
 */

import fs   from 'fs'
import path from 'path'
import os   from 'os'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MetaAlert {
  level:   'info' | 'warning' | 'critical'
  message: string
  metric:  string
}

export interface ContextFileInfo {
  label:  string   // human-readable name, e.g. "CLAUDE.md (global)"
  tokens: number
}

export interface MetaStats {
  ts:                    number
  contextFiles:          ContextFileInfo[]   // files found and their token cost
  contextOverheadTokens: number              // sum of all context file tokens
  alerts:                MetaAlert[]
}

export interface MetaSnapshot {
  ts:                    number
  contextOverheadTokens: number
}

// ─── In-memory history ────────────────────────────────────────────────────────

const MAX_HISTORY = 30
const history: MetaSnapshot[] = []

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Decodes the real cwd from Claude Code's internal project path format.
 *
 * Claude Code stores transcript paths like:
 *   /Users/db/.claude/projects/-Users-db-Documents-GitHub-myproject
 *
 * Where the suffix is the real cwd with each '/' replaced by '-'.
 */
function resolveProjectCwd(storedCwd: string): string {
  const homeDir = os.homedir()
  const projectsDir = path.join(homeDir, '.claude', 'projects')

  if (!storedCwd.startsWith(projectsDir + '/')) return storedCwd

  const encodedPath = storedCwd.slice(projectsDir.length + 1)
  const encodedHome = homeDir.replace(/\//g, '-')

  if (encodedPath.startsWith(encodedHome)) {
    const rest = encodedPath.slice(encodedHome.length)
    return homeDir + rest.replace(/-/g, '/')
  }

  return '/' + encodedPath.replace(/-/g, '/')
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function readFile(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf8') } catch { return '' }
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

// ─── Context file candidates ──────────────────────────────────────────────────

/**
 * Files that Claude Code automatically loads into context.
 * Each candidate is resolved to a full path; non-existent files are skipped.
 *
 * Universal files (always checked):
 *   - ~/.claude/CLAUDE.md         — global instructions for all projects
 *   - ~/.claude/settings.json     — global config (hooks, permissions, model)
 *   - ~/.claude/settings.local.json — personal overrides
 *
 * Project-level files (checked if a project cwd is known):
 *   - {project}/CLAUDE.md         — project-specific instructions
 *   - {project}/AGENTS.md         — instructions for agent mode
 *   - {project}/.claude/CLAUDE.md — alternative project-level location
 */
function resolveContextCandidates(
  homeDir: string,
  projectCwd?: string,
): { label: string; filePath: string }[] {
  const candidates = [
    { label: 'CLAUDE.md (global)',         filePath: path.join(homeDir, '.claude', 'CLAUDE.md') },
    { label: 'settings.json',              filePath: path.join(homeDir, '.claude', 'settings.json') },
    { label: 'settings.local.json',        filePath: path.join(homeDir, '.claude', 'settings.local.json') },
  ]

  if (projectCwd) {
    candidates.push(
      { label: 'CLAUDE.md (proyecto)',     filePath: path.join(projectCwd, 'CLAUDE.md') },
      { label: 'AGENTS.md',               filePath: path.join(projectCwd, 'AGENTS.md') },
      { label: '.claude/CLAUDE.md',       filePath: path.join(projectCwd, '.claude', 'CLAUDE.md') },
    )
  }

  return candidates
}

// ─── Compute ──────────────────────────────────────────────────────────────────

export function computeMetaStats(sessionCwd?: string, contextPct?: number): MetaStats {
  const ts = Date.now()
  const homeDir    = os.homedir()
  const projectCwd = sessionCwd ? resolveProjectCwd(sessionCwd) : undefined

  // ── Detect context files ───────────────────────────────────────────────────
  const contextFiles: ContextFileInfo[] = []
  let contextOverheadTokens = 0

  for (const { label, filePath } of resolveContextCandidates(homeDir, projectCwd)) {
    const content = readFile(filePath)
    if (!content) continue
    const tokens = estimateTokens(content)
    contextFiles.push({ label, tokens })
    contextOverheadTokens += tokens
  }

  // ── Alerts ────────────────────────────────────────────────────────────────
  const alerts: MetaAlert[] = []

  if (contextOverheadTokens > 20_000) {
    alerts.push({
      level: 'critical',
      message: `Overhead de contexto muy alto — ${fmtTok(contextOverheadTokens)} tokens en ${contextFiles.length} archivos`,
      metric: 'context_files',
    })
  } else if (contextOverheadTokens > 10_000) {
    alerts.push({
      level: 'warning',
      message: `Overhead de contexto alto — ${fmtTok(contextOverheadTokens)} tokens en ${contextFiles.length} archivos`,
      metric: 'context_files',
    })
  }

  if (contextPct !== undefined) {
    if (contextPct > 85) {
      alerts.push({ level: 'critical', message: `Auto-compact muy pronto — aprox. ${100 - contextPct}% libre`, metric: 'context' })
    } else if (contextPct > 65) {
      alerts.push({ level: 'warning', message: `Contexto aproximado al ${contextPct}%`, metric: 'context' })
    }
  }

  // ── History ───────────────────────────────────────────────────────────────
  history.push({ ts, contextOverheadTokens })
  if (history.length > MAX_HISTORY) history.shift()

  return { ts, contextFiles, contextOverheadTokens, alerts }
}

export function getMetaHistory(): MetaSnapshot[] {
  return [...history]
}

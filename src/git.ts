/**
 * git.ts — Información de git por proyecto (branch, dirty, ahead/behind)
 *
 * Diseño: módulo puro, síncrono, sin efectos secundarios.
 * Usa child_process.execSync con timeout corto (3s) y stderr silenciado.
 * Retorna null si el directorio no es un repo git o git no está disponible.
 *
 * Por qué síncrono: las llamadas son rápidas (<50ms en repos locales) y
 * se invoca solo bajo demanda, no en el hot path de SSE.
 */

import { execSync } from 'child_process'

export interface GitInfo {
  branch:    string    // nombre del branch o "(sha)" si detached HEAD
  dirty:     boolean   // hay archivos modificados o sin rastrear
  ahead:     number    // commits por delante del remote
  behind:    number    // commits por detrás del remote
  hasRemote: boolean   // el branch tiene upstream configurado
}

const EXEC_OPTS = (cwd: string) => ({
  cwd,
  encoding: 'utf8' as const,
  timeout:  3_000,
  stdio:    ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
})

/**
 * Obtiene información de git para un directorio de proyecto.
 * Retorna null si no es un repo git, git no está en PATH, o hay error.
 */
export function getGitInfo(projectPath: string): GitInfo | null {
  try {
    // ─ Branch ─
    const branchRaw = execSync('git rev-parse --abbrev-ref HEAD', EXEC_OPTS(projectPath)).trim()

    let branch: string
    if (!branchRaw || branchRaw === 'HEAD') {
      // Detached HEAD — mostrar SHA corto
      const sha = execSync('git rev-parse --short HEAD', EXEC_OPTS(projectPath)).trim()
      return { branch: `(${sha})`, dirty: false, ahead: 0, behind: 0, hasRemote: false }
    }
    branch = branchRaw

    // ─ Dirty status ─
    const statusOut = execSync('git status --porcelain', EXEC_OPTS(projectPath)).trim()
    const dirty     = statusOut.length > 0

    // ─ Ahead / behind respecto al upstream ─
    let ahead = 0, behind = 0, hasRemote = false
    try {
      // --left-right: <upstream>...HEAD → "behind\tahead"
      const ab    = execSync('git rev-list --left-right --count @{upstream}...HEAD', EXEC_OPTS(projectPath)).trim()
      const parts = ab.split(/\s+/)
      behind    = parseInt(parts[0] ?? '0', 10) || 0
      ahead     = parseInt(parts[1] ?? '0', 10) || 0
      hasRemote = true
    } catch {
      // No hay upstream configurado — común en branches nuevos
    }

    return { branch, dirty, ahead, behind, hasRemote }
  } catch {
    return null  // no es un repo git o git no disponible
  }
}

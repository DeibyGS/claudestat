/**
 * github.ts — Estado de PR y CI vía GitHub CLI (`gh`)
 *
 * Usa `gh pr view` para obtener PR asociado al branch actual.
 * Retorna null si no hay PR abierto, gh no está disponible, o no es GitHub.
 *
 * Por qué gh CLI y no la API directamente:
 * - gh maneja autenticación automáticamente
 * - Sin necesidad de tokens adicionales
 * - Ya disponible en la mayoría de entornos de desarrollo
 *
 * Nota: `gh pr view` hace una llamada de red → puede ser lento (~500ms-2s).
 * El daemon cachea el resultado 5 minutos por proyecto.
 */

import { execSync } from 'child_process'

export interface PRStatus {
  number:  number
  title:   string
  state:   'OPEN' | 'CLOSED' | 'MERGED'
  url:     string
  branch:  string
  ciState: 'SUCCESS' | 'FAILURE' | 'PENDING' | null  // null = sin checks configurados
}

const EXEC_OPTS = (cwd: string) => ({
  cwd,
  encoding: 'utf8' as const,
  timeout:  8_000,
  stdio:    ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
})

/**
 * Obtiene el estado del PR del branch actual en el repo de GitHub.
 * Retorna null si no hay PR, gh no está disponible, o no es un repo GitHub.
 */
export function getPRStatus(projectPath: string): PRStatus | null {
  try {
    const out = execSync(
      'gh pr view --json number,title,state,url,headRefName,statusCheckRollup',
      EXEC_OPTS(projectPath)
    )
    const pr = JSON.parse(out)

    // ─ Determinar estado de CI desde statusCheckRollup ─
    // Cada check puede tener `state` (PENDING/SUCCESS/FAILURE/ERROR) o
    // `conclusion` (success/failure/cancelled/skipped) según el tipo de check.
    const checks: any[] = pr.statusCheckRollup ?? []
    let ciState: PRStatus['ciState'] = checks.length > 0 ? 'PENDING' : null

    if (checks.length > 0) {
      const statuses = checks.map((c: any) => (c.state ?? c.conclusion ?? '').toUpperCase())
      if (statuses.some(s => s === 'FAILURE' || s === 'ERROR' || s === 'CANCELLED')) {
        ciState = 'FAILURE'
      } else if (statuses.every(s => s === 'SUCCESS' || s === 'SKIPPED')) {
        ciState = 'SUCCESS'
      } else {
        ciState = 'PENDING'
      }
    }

    return {
      number: pr.number,
      title:  pr.title,
      state:  pr.state as PRStatus['state'],
      url:    pr.url,
      branch: pr.headRefName,
      ciState,
    }
  } catch {
    return null  // no hay PR, gh no disponible, o no es GitHub
  }
}

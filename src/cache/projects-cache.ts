// ─── Cache de proyectos ───────────────────────────────────────────────────────
// Pre-computado al arrancar el daemon y refrescado cada 2 minutos en background.
// Esto garantiza que la primera apertura del tab Proyectos sea instantánea
// y que los cambios de HANDOFF.md se reflejen sin reiniciar.

import { discoverProjects } from '../project-scanner'
import { getGitInfo, type GitInfo } from '../git'
import { getPRStatus, type PRStatus } from '../github'

let _projectsCache: ReturnType<typeof discoverProjects> | null = null
let _projectsCacheTs = 0
const PROJECTS_CACHE_TTL = 2 * 60_000  // 2 minutos

export function getProjectsCached(): ReturnType<typeof discoverProjects> {
  if (_projectsCache && Date.now() - _projectsCacheTs < PROJECTS_CACHE_TTL) {
    return _projectsCache
  }
  _projectsCache = discoverProjects()
  _projectsCacheTs = Date.now()
  return _projectsCache
}

export function invalidateProjectsCache() {
  _projectsCache = null
}

export { PROJECTS_CACHE_TTL }

// Caché de git info por project path — TTL 30s
const gitCache = new Map<string, { data: GitInfo | null; ts: number }>()
// Caché de PR status por project path — TTL 5min (llamada de red)
const prCache  = new Map<string, { data: PRStatus | null; ts: number }>()

const GIT_TTL = 30_000
const PR_TTL  = 5 * 60_000

export function getCachedGitInfo(projectPath: string): GitInfo | null {
  const cached = gitCache.get(projectPath)
  if (cached && Date.now() - cached.ts < GIT_TTL) return cached.data
  const data = getGitInfo(projectPath)
  gitCache.set(projectPath, { data, ts: Date.now() })
  return data
}

export function getCachedPRStatus(projectPath: string): PRStatus | null {
  const cached = prCache.get(projectPath)
  if (cached && Date.now() - cached.ts < PR_TTL) return cached.data
  const data = getPRStatus(projectPath)
  prCache.set(projectPath, { data, ts: Date.now() })
  return data
}

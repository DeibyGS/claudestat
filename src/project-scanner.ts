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
  jsonlStats:   JSONLStats     // datos históricos leídos directamente de los JSONL
}

export interface ModelUsage {
  opusTokens:   number
  sonnetTokens: number
  haikuTokens:  number
}

export interface JSONLStats {
  session_count:  number
  total_cost_usd: number
  total_tokens:   number
  last_active:    number | null
  modelUsage:     ModelUsage
}

// ─── Decode ───────────────────────────────────────────────────────────────────

/**
 * Decodifica el nombre de directorio de Claude Code al path real.
 * "-Users-db-Documents-GitHub-claudetrace" → "/Users/db/Documents/GitHub/claudetrace"
 *
 * Problema: directorios con '-' en el nombre (ej: "gmail-ai-agent") se confunden
 * con separadores de path. Solución: búsqueda greedy recursiva por el filesystem.
 */
export function decodeProjectDir(encodedName: string): string | null {
  const homeDir     = os.homedir()
  const encodedHome = homeDir.replace(/\//g, '-')   // "/Users/db" → "-Users-db"

  if (!encodedName.startsWith(encodedHome)) return null

  const rest = encodedName.slice(encodedHome.length)  // "-Documents-GitHub-gmail-ai-agent"
  if (!rest || rest === '') return null

  // Búsqueda greedy: prueba cada posición de '-' como posible '/'
  // Esto resuelve ambigüedad con nombres de directorio que contienen '-'
  const found = findRealPath(homeDir, rest.slice(1))  // quitar el '-' inicial
  return found === homeDir ? null : found
}

/**
 * Dado un directorio base y un string con segmentos separados por '-',
 * encuentra el path real en disco probando cada combinación posible.
 * Ejemplo: base="/Users/db/Documents/GitHub", remaining="gmail-ai-agent"
 *   → prueba "gmail" (no existe), "gmail-ai" (no existe), "gmail-ai-agent" (✓)
 */
function findRealPath(base: string, remaining: string): string | null {
  if (!remaining) return fs.existsSync(base) ? base : null

  const parts    = remaining.split('-')
  let   segment  = ''

  for (let i = 0; i < parts.length; i++) {
    segment = segment ? segment + '-' + parts[i] : parts[i]
    const candidate = path.join(base, segment)

    try { if (!fs.statSync(candidate).isDirectory()) continue } catch { continue }

    const leftover = parts.slice(i + 1).join('-')
    if (!leftover) return candidate           // consumido todo → éxito

    const deeper = findRealPath(candidate, leftover)
    if (deeper) return deeper
  }

  return null
}

// ─── HANDOFF parser ───────────────────────────────────────────────────────────

export function parseHandoffProgress(content: string): HandoffProgress {
  // Formato markdown: - [x] / - [ ]
  const mdDone    = (content.match(/- \[x\]/gi) || []).length
  const mdPending = (content.match(/- \[ \]/g)  || []).length

  // Formato emoji (ej: WodRival): ✅ done, 🟡/⬜/☐ pending — en líneas de lista
  // Patrón: línea con número o guión, seguida de ✅ o emoji de pendiente
  const emojiDone    = (content.match(/^[\s]*\d+\.\s+✅/gm) || []).length
  const emojiPending = (content.match(/^[\s]*\d+\.\s+(?:🟡|⬜|☐|🔲)/gm) || []).length

  // Formato lista numerada simple (sin emoji de estado) → contar como pendientes
  // Solo aplica si no hay ningún otro formato detectado
  const hasAnyFormat = mdDone + mdPending + emojiDone + emojiPending > 0
  const plainPending = hasAnyFormat ? 0
    : (content.match(/^[\s]*\d+\.\s+(?!✅|🟡|⬜|☐|🔲|\[)(.+)$/gm) || []).length

  const done  = mdDone    + emojiDone
  const total = done + mdPending + emojiPending + plainPending
  const pct   = total > 0 ? Math.round(done / total * 100) : 0

  // Primera tarea pendiente
  let nextTask: string | null = null
  const lines = content.split('\n')
  for (const line of lines) {
    // Formato markdown
    const m1 = line.match(/^[\s]*- \[ \]\s*(.+)$/)
    if (m1) { nextTask = m1[1].trim().replace(/^\*\*/, '').replace(/\*\*$/, ''); break }
    // Formato emoji
    const m2 = line.match(/^[\s]*\d+\.\s+(?:🟡|⬜|☐|🔲)\s+\*?\*?(.+?)(?:\*\*)?$/)
    if (m2) { nextTask = m2[1].trim().replace(/^\*\*/, '').replace(/\*\*$/, '').replace(/\s*—.*$/, ''); break }
  }

  return { done, total, pct, nextTask }
}

// ─── JSONL stats (datos históricos sin daemon) ────────────────────────────────

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

// Precios en USD por millón de tokens (misma tabla que enricher.ts)
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheCreate: number }> = {
  'claude-opus-4-6':           { input: 15,   output: 75,  cacheRead: 1.50, cacheCreate: 18.75 },
  'claude-sonnet-4-6':         { input: 3,    output: 15,  cacheRead: 0.30, cacheCreate: 3.75  },
  'claude-haiku-4-5':          { input: 0.80, output: 4,   cacheRead: 0.08, cacheCreate: 1.00  },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4,   cacheRead: 0.08, cacheCreate: 1.00  },
}
const DEFAULT_PRICING = PRICING['claude-sonnet-4-6']

function calcCost(model: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): number {
  const p = PRICING[model] ?? DEFAULT_PRICING
  const M = 1_000_000
  return (
    (usage.input_tokens                  * p.input)       / M +
    (usage.output_tokens                 * p.output)      / M +
    (usage.cache_read_input_tokens       * p.cacheRead)   / M +
    (usage.cache_creation_input_tokens   * p.cacheCreate) / M
  )
}

/**
 * Lee todos los JSONL del directorio codificado de un proyecto y acumula
 * tokens y coste. No requiere que el daemon haya estado corriendo.
 */
export function getJSONLStats(encodedDir: string): JSONLStats {
  const dirPath = path.join(PROJECTS_DIR, encodedDir)
  let sessionCount = 0, totalCost = 0, totalTokens = 0, lastActive: number | null = null
  const modelUsage: ModelUsage = { opusTokens: 0, sonnetTokens: 0, haikuTokens: 0 }

  try {
    const files = fs.readdirSync(dirPath)
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const sessionId = file.slice(0, -6)
      if (!sessionId.includes('-') || sessionId.length < 10) continue

      const filePath = path.join(dirPath, file)
      try {
        const stat = fs.statSync(filePath)
        if (!lastActive || stat.mtimeMs > lastActive) lastActive = stat.mtimeMs

        const content = fs.readFileSync(filePath, 'utf8')
        let hasAssistant = false

        for (const raw of content.split('\n')) {
          const line = raw.trim()
          if (!line) continue
          try {
            const obj = JSON.parse(line)
            if (obj.type !== 'assistant') continue
            const usage = obj.message?.usage
            const model = (obj.message?.model as string) ?? 'claude-sonnet-4-6'
            if (!usage) continue

            hasAssistant = true
            const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
            totalCost   += calcCost(model, usage)
            totalTokens += tokens
            if      (model.includes('opus'))  modelUsage.opusTokens   += tokens
            else if (model.includes('haiku')) modelUsage.haikuTokens  += tokens
            else                              modelUsage.sonnetTokens += tokens
          } catch { /* línea malformada */ }
        }

        if (hasAssistant) sessionCount++
      } catch { /* archivo inaccesible */ }
    }
  } catch { /* directorio no encontrado */ }

  return { session_count: sessionCount, total_cost_usd: totalCost, total_tokens: totalTokens, last_active: lastActive, modelUsage }
}

// ─── Inferencia de raíz de proyecto desde JSONL ───────────────────────────────

/**
 * Marcadores de raíz de proyecto, en orden de prioridad.
 * El primer marcador encontrado al subir el árbol determina la raíz.
 */
const PROJECT_MARKERS = [
  'HANDOFF.md',       // claudetrace — más específico
  '.git',             // git repo — universal
  'package.json',     // Node.js
  'pyproject.toml',   // Python moderno
  'requirements.txt', // Python clásico
  'go.mod',           // Go
  'Cargo.toml',       // Rust
  'pom.xml',          // Java/Maven
  'build.gradle',     // Java/Gradle
]

/**
 * Sube el árbol de directorios desde un file_path hasta encontrar
 * el primer marcador de proyecto conocido. Retorna ese directorio.
 */
function findProjectRoot(filePath: string): string | null {
  let dir = path.dirname(filePath)
  for (let i = 0; i < 10; i++) {
    for (const marker of PROJECT_MARKERS) {
      if (fs.existsSync(path.join(dir, marker))) return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break   // llegamos a '/'
    dir = parent
  }
  return null
}

/**
 * Para directorios con múltiples proyectos (ej: home dir con sesiones variadas),
 * lee cada JSONL individualmente, infiere su proyecto y calcula sus stats.
 *
 * Retorna un Map de projectRoot → JSONLStats con datos precisos por proyecto.
 */
function getJSONLStatsByProject(dirPath: string): Map<string, JSONLStats> {
  const result   = new Map<string, JSONLStats>()
  const INFER_LINES = 150   // líneas para inferir el proyecto
  const FILE_TOOLS  = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'MultiEdit'])

  let jsonlFiles: string[]
  try {
    jsonlFiles = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.jsonl') && f.includes('-') && f.length > 10)
  } catch { return result }

  for (const file of jsonlFiles) {
    const filePath = path.join(dirPath, file)
    try {
      const stat    = fs.statSync(filePath)
      const content = fs.readFileSync(filePath, 'utf8')
      const lines   = content.split('\n')

      // ── Inferir proyecto desde los primeros INFER_LINES ──────────────────
      const rootCounts = new Map<string, number>()
      for (const raw of lines.slice(0, INFER_LINES)) {
        try {
          const obj = JSON.parse(raw.trim())
          if (obj.type !== 'assistant') continue
          const blocks = obj.message?.content
          if (!Array.isArray(blocks)) continue
          for (const block of blocks) {
            if (block.type !== 'tool_use' || !FILE_TOOLS.has(block.name)) continue
            const fp = (block.input?.file_path || block.input?.path) as string | undefined
            if (!fp?.startsWith('/')) continue
            const root = findProjectRoot(fp)
            if (root) rootCounts.set(root, (rootCounts.get(root) ?? 0) + 1)
          }
        } catch { /* ignorar */ }
      }
      if (rootCounts.size === 0) continue
      const projectRoot = [...rootCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]

      // ── Calcular coste y tokens de este JSONL completo ───────────────────
      let cost = 0, tokens = 0, hasAssistant = false
      const mu: ModelUsage = { opusTokens: 0, sonnetTokens: 0, haikuTokens: 0 }
      for (const raw of lines) {
        try {
          const obj = JSON.parse(raw.trim())
          if (obj.type !== 'assistant') continue
          const usage = obj.message?.usage
          const model = obj.message?.model ?? 'claude-sonnet-4-6'
          if (!usage) continue
          hasAssistant = true
          const t = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
          cost   += calcCost(model, usage)
          tokens += t
          if      (model.includes('opus'))  mu.opusTokens   += t
          else if (model.includes('haiku')) mu.haikuTokens  += t
          else                              mu.sonnetTokens += t
        } catch { /* ignorar */ }
      }
      if (!hasAssistant) continue

      // ── Acumular en el mapa de resultados ────────────────────────────────
      const existing = result.get(projectRoot)
      if (existing) {
        existing.session_count++
        existing.total_cost_usd += cost
        existing.total_tokens   += tokens
        existing.modelUsage.opusTokens   += mu.opusTokens
        existing.modelUsage.sonnetTokens += mu.sonnetTokens
        existing.modelUsage.haikuTokens  += mu.haikuTokens
        if (stat.mtimeMs > (existing.last_active ?? 0)) existing.last_active = stat.mtimeMs
      } else {
        result.set(projectRoot, {
          session_count: 1, total_cost_usd: cost,
          total_tokens: tokens, last_active: stat.mtimeMs, modelUsage: mu,
        })
      }
    } catch { /* archivo inaccesible */ }
  }

  return result
}

/**
 * Encuentra la mejor raíz de proyecto para un directorio dado.
 * Prioridad: HANDOFF.md (subiendo hasta 4 niveles) → .git → cualquier marker → el dir mismo.
 *
 * HANDOFF.md tiene prioridad sobre .git y package.json porque es el marker
 * que el usuario mantiene conscientemente para claudetrace.
 */
function findBestProjectRoot(dir: string): string {
  // 1. Buscar HANDOFF.md subiendo el árbol (hasta 4 niveles)
  let current = dir
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(current, 'HANDOFF.md'))) return current
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  // 2. Buscar cualquier otro marker de proyecto
  const byMarker = findProjectRoot(dir)
  if (byMarker) return byMarker
  // 3. Fallback: usar el dir tal cual
  return dir
}

// ─── Auto-crear HANDOFF para proyectos sin uno ───────────────────────────────

/**
 * Detecta el stack tecnológico de un proyecto desde los archivos presentes.
 * Retorna una lista de strings legibles como "Node.js", "Python", etc.
 */
function detectStack(projectPath: string): string[] {
  const markers: [string, string][] = [
    ['package.json',     'Node.js'],
    ['pyproject.toml',   'Python'],
    ['requirements.txt', 'Python'],
    ['go.mod',           'Go'],
    ['Cargo.toml',       'Rust'],
    ['pom.xml',          'Java / Maven'],
    ['build.gradle',     'Java / Gradle'],
    ['Gemfile',          'Ruby'],
    ['pubspec.yaml',     'Flutter / Dart'],
    ['build.gradle.kts', 'Kotlin'],
    ['AndroidManifest.xml', 'Android'],
    ['Info.plist',       'iOS / macOS'],
    ['*.sln',            '.NET'],
  ]
  const detected: string[] = []
  for (const [file, label] of markers) {
    if (file.includes('*')) {
      try {
        const ext = file.replace('*.', '.')
        if (fs.readdirSync(projectPath).some(f => f.endsWith(ext))) detected.push(label)
      } catch { /* ignorar */ }
    } else {
      if (fs.existsSync(path.join(projectPath, file))) detected.push(label)
    }
  }
  return [...new Set(detected)]  // deduplicar
}

/**
 * Genera y escribe un HANDOFF.md mínimo para proyectos que no tienen uno.
 * El archivo se marca como auto-generado para que el usuario lo complete.
 * No sobreescribe si ya existe.
 */
export function autoCreateHandoff(projectPath: string, stats: JSONLStats): void {
  const handoffPath = path.join(projectPath, 'HANDOFF.md')
  if (fs.existsSync(handoffPath)) return  // ya existe, no tocar

  const name    = path.basename(projectPath)
  const stack   = detectStack(projectPath)
  const stackStr = stack.length > 0 ? stack.join(', ') : 'no detectado'
  const cost    = stats.total_cost_usd.toFixed(2)
  const tokens  = stats.total_tokens >= 1_000_000
    ? `${(stats.total_tokens / 1_000_000).toFixed(1)}M`
    : stats.total_tokens >= 1_000
    ? `${Math.round(stats.total_tokens / 1_000)}K`
    : String(stats.total_tokens)

  const content = `# HANDOFF — ${name}
<!-- Auto-generado por claudetrace. Completá las secciones marcadas con TODO. -->

## Current Status
- Branch: \`TODO — indicar rama principal\`
- Stack: ${stackStr}
- Sesiones con Claude Code: ${stats.session_count} | Coste total: $${cost} | Tokens: ${tokens}

## Pending Tasks
- [ ] TODO — agregar las tareas pendientes del proyecto
- [ ] TODO — describir el objetivo actual

## Gotchas / Notas
- TODO — anotar decisiones importantes, bugs conocidos, contexto crítico

## Session Log
- **${new Date().toISOString().slice(0, 10)}** — HANDOFF creado automáticamente por claudetrace
`

  try {
    fs.writeFileSync(handoffPath, content, 'utf8')
  } catch { /* sin permisos de escritura — ignorar silenciosamente */ }
}

// ─── Scanner principal ────────────────────────────────────────────────────────

/**
 * Descubre todos los proyectos en los que se ha trabajado con Claude Code.
 *
 * Estrategia (Opción A):
 * 1. Para cada directorio en ~/.claude/projects/:
 *    a. Intenta decodificar el nombre (rápido) → busca mejor raíz subiendo árbol
 *    b. Si falla → infiere desde file paths del JSONL
 * 2. Agrupa por raíz de proyecto (varios dirs Claude Code → mismo repo)
 * 3. Para cada raíz única: lee HANDOFF, calcula progreso, suma stats JSONL
 */
export function discoverProjects(): ProjectScanResult[] {
  // Mapa: inodeKey → { bestPath (canónico), encodedDirs[], jsonlStats acumulados }
  const projectMap = new Map<string, {
    bestPath:    string
    encodedDirs: string[]
    jsonlStats:  JSONLStats
  }>()

  let dirs: string[]
  try { dirs = fs.readdirSync(PROJECTS_DIR) } catch { return [] }

  for (const encodedDir of dirs) {
    const dirPath = path.join(PROJECTS_DIR, encodedDir)
    try { if (!fs.statSync(dirPath).isDirectory()) continue } catch { continue }

    // ── Paso 1: encontrar la raíz real del proyecto ──────────────────────────
    let projectRoot: string | null = null

    // Intento rápido: decodificar el nombre del directorio
    const decoded = decodeProjectDir(encodedDir)
    if (decoded && fs.existsSync(decoded)) {
      // Subir el árbol buscando HANDOFF.md primero, luego otros markers
      projectRoot = findBestProjectRoot(decoded)
    }

    // ── Paso 2: acumular stats en el mapa ────────────────────────────────────

    // Clave única por directorio: inode resuelve case en macOS y symlinks en Linux
    const inodeKey = (p: string): string => {
      try { const s = fs.statSync(p); return `${s.dev}:${s.ino}` } catch { return p }
    }

    // Helper para registrar un projectRoot con sus stats
    const registerRoot = (root: string, stats: JSONLStats) => {
      if (root === os.homedir()) return   // nunca registrar el home dir
      const best     = findBestProjectRoot(root)
      const bestKey  = inodeKey(best)
      const homeKey  = inodeKey(os.homedir())
      if (bestKey === homeKey) return
      const existing = projectMap.get(bestKey)
      if (existing) {
        existing.encodedDirs.push(encodedDir)
        existing.jsonlStats.session_count            += stats.session_count
        existing.jsonlStats.total_cost_usd           += stats.total_cost_usd
        existing.jsonlStats.total_tokens             += stats.total_tokens
        existing.jsonlStats.modelUsage.opusTokens   += stats.modelUsage.opusTokens
        existing.jsonlStats.modelUsage.sonnetTokens += stats.modelUsage.sonnetTokens
        existing.jsonlStats.modelUsage.haikuTokens  += stats.modelUsage.haikuTokens
        if (stats.last_active && (!existing.jsonlStats.last_active || stats.last_active > existing.jsonlStats.last_active)) {
          existing.jsonlStats.last_active = stats.last_active
        }
      } else {
        projectMap.set(bestKey, {
          encodedDirs: [encodedDir],
          jsonlStats:  { ...stats, modelUsage: { ...stats.modelUsage } },
          bestPath:    best,
        })
      }
    }

    if (projectRoot) {
      registerRoot(projectRoot, getJSONLStats(encodedDir))
    } else {
      // Fallback multi-proyecto: stats precisas por JSONL individual
      const byProject = getJSONLStatsByProject(dirPath)
      for (const [root, stats] of byProject) {
        if (fs.existsSync(root)) registerRoot(root, stats)
      }
    }
  }

  // ── Paso 3: construir resultados con HANDOFF y progreso ───────────────────
  const raw: ProjectScanResult[] = []

  for (const [, { bestPath: rootPath, encodedDirs, jsonlStats }] of projectMap) {
    const handoffPath = path.join(rootPath, 'HANDOFF.md')

    // Auto-crear HANDOFF si el proyecto no tiene uno
    if (!fs.existsSync(handoffPath)) {
      autoCreateHandoff(rootPath, jsonlStats)
    }

    const hasHandoff  = fs.existsSync(handoffPath)
    const progress    = hasHandoff
      ? parseHandoffProgress(fs.readFileSync(handoffPath, 'utf8'))
      : { done: 0, total: 0, pct: 0, nextTask: null }

    // last_active = max(JSONL mtime, HANDOFF.md mtime)
    if (hasHandoff) {
      try {
        const handoffMtime = fs.statSync(handoffPath).mtimeMs
        if (handoffMtime > (jsonlStats.last_active ?? 0)) {
          jsonlStats.last_active = handoffMtime
        }
      } catch { /* ignorar */ }
    }

    raw.push({
      path:       rootPath,
      name:       path.basename(rootPath),
      encodedDir: encodedDirs[0],
      hasHandoff,
      progress,
      jsonlStats,
    })
  }

  // Deduplicar por inode: identifica el mismo directorio independientemente del case o symlinks
  const inodeKey = (p: string) => {
    try { const s = fs.statSync(p); return `${s.dev}:${s.ino}` } catch { return p }
  }
  const dedup = new Map<string, ProjectScanResult>()
  for (const r of raw) {
    const key      = inodeKey(r.path)
    const existing = dedup.get(key)
    if (existing) {
      existing.jsonlStats.session_count            += r.jsonlStats.session_count
      existing.jsonlStats.total_cost_usd           += r.jsonlStats.total_cost_usd
      existing.jsonlStats.total_tokens             += r.jsonlStats.total_tokens
      existing.jsonlStats.modelUsage.opusTokens   += r.jsonlStats.modelUsage.opusTokens
      existing.jsonlStats.modelUsage.sonnetTokens += r.jsonlStats.modelUsage.sonnetTokens
      existing.jsonlStats.modelUsage.haikuTokens  += r.jsonlStats.modelUsage.haikuTokens
      if ((r.jsonlStats.last_active ?? 0) > (existing.jsonlStats.last_active ?? 0))
        existing.jsonlStats.last_active = r.jsonlStats.last_active
    } else {
      dedup.set(key, r)
    }
  }

  return [...dedup.values()]
}

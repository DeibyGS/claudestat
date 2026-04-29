// ─── POST /event — recibe eventos de los hooks de Claude Code ─────────────────

import path from 'path'
import fs   from 'fs'
import { Router, type Request, type Response } from 'express'
import { dbOps }                               from '../db'
import { analyzeSession }                      from '../intelligence'
import { summarizeSession }                    from '../summarizer'
import { deriveSessionState, STATE_META }      from '../session-state'
import { computeQuota, invalidateQuotaCache }  from '../quota-tracker'
import { readConfig, getWarnLevel }            from '../config'
import { isRateLimited }                       from '../middleware/rate-limiter'
import { broadcast, sessionLastEvent }         from './stream'
import {
  processLatestForSession,
  type CostUpdateCallback,
  type CompactDetectedCallback,
} from '../enricher'

export const eventsRouter = Router()

// Skill activa por sesión — se setea tras Skill Done, se limpia en Stop.
// Permite taggear los eventos siguientes con skill_parent para agruparlos en la UI.
const activeSkillBySession = new Map<string, string>()

// Último Agent PreToolUse por CWD — se usa para detectar sub-sesiones de agentes.
// Clave: cwd  Valor: { pre_ts, session_id }
export const lastAgentByCwd = new Map<string, { pre_ts: number; session_id: string }>()

// Sesiones ya evaluadas para taggeo de parent — evita re-evaluar en cada cost update.
export const taggedSessionParents = new Set<string>()

// ─── Quota alerter: moving average de 3 muestras + cooldown 1h por nivel ─────
// Evita falsas alarmas por spikes puntuales. Solo emite si el promedio de las
// últimas 3 lecturas supera el threshold Y no se emitió ese nivel en la última hora.

const quotaSamples: number[] = []            // últimas 3 lecturas de cyclePct
const alertCooldown = new Map<string, number>() // nivel → timestamp del último aviso
const ALERT_COOLDOWN_MS = 60 * 60 * 1000    // 1 hora
const SAMPLES_NEEDED    = 3                  // muestras para el moving average

function shouldFireAlert(level: 'yellow' | 'orange' | 'red', pct: number): boolean {
  // Añadir muestra al buffer circular (máx SAMPLES_NEEDED)
  quotaSamples.push(pct)
  if (quotaSamples.length > SAMPLES_NEEDED) quotaSamples.shift()

  // Necesitamos SAMPLES_NEEDED lecturas antes de disparar (evita alert en el primer spike)
  if (quotaSamples.length < SAMPLES_NEEDED) return false

  // Cooldown: no repetir el mismo nivel en la última hora
  const lastFired = alertCooldown.get(level) ?? 0
  if (Date.now() - lastFired < ALERT_COOLDOWN_MS) return false

  alertCooldown.set(level, Date.now())
  return true
}

/** Sube el árbol desde un file_path hasta encontrar HANDOFF.md → directorio del proyecto */
export function findProjectCwdForFile(filePath: string): string | undefined {
  let dir = path.dirname(filePath)
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'HANDOFF.md'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

eventsRouter.post('/event', (req: Request, res: Response) => {
  const ip = req.ip ?? '127.0.0.1'
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Demasiadas peticiones — espera 1 minuto' })
    return
  }

  const { type, session_id, tool_name, tool_input, tool_response, ts, cwd, transcript_path } = req.body

  if (!session_id || !type) {
    res.status(400).json({ error: 'Faltan session_id o type' })
    return
  }

  const resolvedCwd = cwd
    ?? (transcript_path ? transcript_path.split('/').slice(0, -1).join('/') : undefined)

  dbOps.upsertSession({ id: session_id, cwd: resolvedCwd, started_at: ts, last_event_at: ts })

  // Skill grouping: get current parent BEFORE processing this event
  // (the Skill Done event itself is NOT tagged — only its subsequent sub-calls are)
  const skillParent = (tool_name !== 'Skill' && type !== 'Stop')
    ? activeSkillBySession.get(session_id)
    : undefined

  if (type === 'PostToolUse' && tool_name) {
    const pairedId = dbOps.pairPostWithPre(
      session_id, tool_name,
      typeof tool_response === 'string' ? tool_response : JSON.stringify(tool_response ?? ''),
      ts
    )
    // Truncar tool_response a 4000 chars para no saturar SSE con archivos grandes
    const rawResp  = typeof tool_response === 'string' ? tool_response : JSON.stringify(tool_response ?? '')
    const tool_output = rawResp.length > 4000
      ? rawResp.slice(0, 4000) + `\n…[truncado: ${rawResp.length} chars]`
      : rawResp
    broadcast({ type: 'event', payload: { type: 'Done', session_id, tool_name, tool_input: tool_input != null ? JSON.stringify(tool_input) : undefined, tool_output, ts, pairedId, skill_parent: skillParent } })

    // Activar skill parent para los eventos siguientes si este fue un Skill Done
    if (tool_name === 'Skill') {
      try {
        const inp = typeof tool_input === 'object' ? tool_input : JSON.parse(tool_input ?? '{}')
        activeSkillBySession.set(session_id, inp?.skill || inp?.name || 'skill')
      } catch { activeSkillBySession.set(session_id, 'skill') }
    }
  } else {
    dbOps.insertEvent({
      session_id, type,
      tool_name: tool_name ?? undefined,
      tool_input: tool_input ? JSON.stringify(tool_input) : undefined,
      ts, cwd: resolvedCwd, skill_parent: skillParent
    })
    broadcast({ type: 'event', payload: { ...req.body, skill_parent: skillParent } })

    // Stop limpia el skill activo para esta sesión
    if (type === 'Stop') activeSkillBySession.delete(session_id)

    // Registrar Agent PreToolUse para detección de sub-sesiones
    if (type === 'PreToolUse' && tool_name === 'Agent' && resolvedCwd) {
      lastAgentByCwd.set(resolvedCwd, { pre_ts: ts, session_id })
    }
  }

  // Intentar etiquetar la sesión con su proyecto (solo en eventos de herramientas de archivo)
  const FILE_TOOLS = new Set(['Read','Write','Edit','Glob','Grep'])
  if (FILE_TOOLS.has(tool_name || '') && tool_input) {
    try {
      const inp      = typeof tool_input === 'string' ? JSON.parse(tool_input) : tool_input
      const filePath = (inp.file_path || inp.path) as string | undefined
      if (filePath?.startsWith('/')) {
        const projectCwd = findProjectCwdForFile(filePath)
        if (projectCwd) dbOps.updateSessionProject(session_id, projectCwd)
      }
    } catch { /* ignorar errores de parsing */ }
  }

  // Actualizar estado de sesión en memoria + broadcast state_change via SSE
  sessionLastEvent.set(session_id, { type, ts })
  const state     = deriveSessionState(type, ts)
  const stateMeta = STATE_META[state]
  broadcast({ type: 'state_change', payload: { session_id, state, ...stateMeta } })

  // Al terminar un turno (Stop) → invalidar quota cache + emitir warnings
  if (type === 'Stop') {
    invalidateQuotaCache()
    // Emitir warning SSE si la cuota supera algún threshold (moving avg 3 muestras + cooldown 1h)
    setImmediate(() => {
      try {
        const cfg   = readConfig()
        const data  = computeQuota(cfg.plan ?? undefined)
        const level = getWarnLevel(data.cyclePct, cfg.warnThresholds)
        // shouldFireAlert acumula siempre la muestra; devuelve true solo si avg estable + cooldown ok
        if (level && shouldFireAlert(level, data.cyclePct)) {
          broadcast({
            type: 'quota_warning',
            payload: {
              level,
              cyclePct:   data.cyclePct,
              cycleLimit: data.cycleLimit,
              resetMs:    data.cycleResetMs,
              blocked:    cfg.killSwitchEnabled && data.cyclePct >= cfg.killSwitchThreshold,
            }
          })
        } else if (!level) {
          // Sin nivel activo → alimentar el buffer igualmente para que las próximas muestras sean correctas
          quotaSamples.push(data.cyclePct)
          if (quotaSamples.length > SAMPLES_NEEDED) quotaSamples.shift()
        }
      } catch { /* ignorar errores al calcular quota */ }
    })
    // Generar resumen IA solo si el usuario lo activa explícitamente
    // Activar: CLAUDESTAT_AI_SUMMARY=true claudestat start
    if (process.env.CLAUDESTAT_AI_SUMMARY === 'true') {
      setImmediate(async () => {
        try {
          const session = dbOps.getSession(session_id)
          if (!session) return
          const events      = dbOps.getSessionEvents(session_id)
          const projectName = session.project_path ? path.basename(session.project_path) : undefined
          const summary     = await summarizeSession(events, session.total_cost_usd ?? 0, projectName)
          if (summary) {
            dbOps.updateSessionSummary(session_id, summary)
            broadcast({ type: 'summary_ready', payload: { session_id, summary } })
          }
        } catch { /* ignorar errores del summarizer */ }
      })
    }
  }

  res.json({ ok: true })
})

// ─── Callback del enricher ────────────────────────────────────────────────────

/**
 * Cuando el enricher detecta nuevos tokens en un JSONL:
 * 1. Corre el análisis de inteligencia
 * 2. Guarda el coste + score en DB
 * 3. Hace broadcast vía SSE para que el watch muestre el coste actualizado
 */
export const onCostUpdate: CostUpdateCallback = (sessionId, cost) => {
  // Ensure session row exists — sub-agent JSONLs arrive from the enricher without a
  // prior hook event (Claude Code does not fire hooks for sub-agent sessions).
  let sessionRow = dbOps.getSession(sessionId)
  if (!sessionRow) {
    dbOps.upsertSession({ id: sessionId, cwd: undefined, started_at: cost.firstTs ?? Date.now(), last_event_at: cost.firstTs ?? Date.now() })
    sessionRow = dbOps.getSession(sessionId)
  }

  // Sub-agent detection: first time we see a session, check if its firstTs falls after
  // a recent Agent PreToolUse from another session in the same CWD → tag as child.
  if (!taggedSessionParents.has(sessionId) && cost.firstTs) {
    taggedSessionParents.add(sessionId)
    const cwd = sessionRow?.cwd
    if (cwd) {
      const agentInfo = lastAgentByCwd.get(cwd)
      if (agentInfo && agentInfo.session_id !== sessionId && agentInfo.pre_ts < cost.firstTs) {
        dbOps.updateSessionParent(sessionId, agentInfo.session_id)
      }
    }
  }

  const events  = dbOps.getSessionEvents(sessionId)
  const report  = analyzeSession(events, cost.cost_usd)

  dbOps.updateSessionCost(sessionId, cost, report.efficiencyScore, report.loops.length)

  const startedAt = sessionRow?.started_at ?? Date.now()
  const sessionDurationMinutes = (Date.now() - startedAt) / 60_000
  const projectedHourlyUsd = sessionDurationMinutes > 0.5
    ? cost.cost_usd / sessionDurationMinutes * 60
    : 0

  broadcast({
    type: 'cost_update',
    payload: {
      session_id:            sessionId,
      cost_usd:              cost.cost_usd,
      input_tokens:          cost.input_tokens,
      output_tokens:         cost.output_tokens,
      cache_read:            cost.cache_read,
      cache_creation:        cost.cache_creation,
      context_used:          cost.context_used,
      context_window:        cost.context_window,
      efficiency_score:      report.efficiencyScore,
      loops:                 report.loops,
      summary:               report.summary,
      model:                 cost.lastModel,
      projected_hourly_usd:  projectedHourlyUsd,
    }
  })

  // Emitir desglose de costo del último bloque (input vs output) para el TracePanel
  if (cost.lastEntry) {
    broadcast({
      type: 'block_cost',
      payload: {
        session_id:   sessionId,
        inputUsd:     cost.lastEntry.inputUsd,
        outputUsd:    cost.lastEntry.outputUsd,
        totalUsd:     cost.lastEntry.totalUsd,
        inputTokens:  cost.lastEntry.inputTokens,
        outputTokens: cost.lastEntry.outputTokens,
      }
    })
  }
}

// ─── Callback de auto-compact ────────────────────────────────────────────────

export const onCompactDetected: CompactDetectedCallback = (sessionId) => {
  broadcast({ type: 'compact_detected', payload: { session_id: sessionId, ts: Date.now() } })
  console.log(`[daemon] Auto-compact detectado para sesión ${sessionId.slice(0, 8)}`)
}

// Exponer callback para que stream.ts pueda inyectarlo en processLatestForSession
export { processLatestForSession }

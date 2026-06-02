// ─── POST /event — recibe eventos de los hooks de Claude Code ─────────────────

import fs   from 'fs'
import path from 'path'
import { Router, type Request, type Response } from 'express'
import { dbOps }                               from '../db'
import { analyzeSession, analyzeSemanticLoops, predictSaturation } from '../intelligence'
import { summarizeSession }                    from '../summarizer'
import { deriveSessionState, STATE_META }      from '../session-state'
import { computeQuota, invalidateQuotaCache }  from '../quota-tracker'
import { readConfig, getWarnLevel }            from '../config'
import { isRateLimited }                       from '../middleware/rate-limiter'
import { broadcast, sessionLastEvent }         from './stream'
import { sendDesktopNotification }             from '../notifier'
import { findProjectCwdForFile }               from './helpers'
import {
  processLatestForSession,
  cleanupSession,
  type CostUpdateCallback,
  type CompactDetectedCallback,
} from '../enricher'
import { findJSONLForSession, extractSemanticData } from '../watchers/claude-code'

// ─── Semantic extraction debounce: 3s after last new assistant turn ───────────
const semanticDebounce = new Map<string, ReturnType<typeof setTimeout>>()

// ─── Predictive saturation: context samples + alert cooldown per session ──────
const contextSamples   = new Map<string, Array<{ ts: number; context_used: number }>>()
const saturationCooldown = new Map<string, number>()
const SATURATION_WARN_MINUTES = 30
const SATURATION_COOLDOWN_MS  = 15 * 60_000
const CONTEXT_SAMPLES_MAX     = 20

// ─── Loop alert cooldown (toolName:sessionId → last alert ts) ─────────────────
const loopAlertCooldown = new Map<string, number>()
const LOOP_ALERT_COOLDOWN_MS = 120_000  // coincide con LOOP_COOLDOWN_MS en intelligence.ts

// ─── Context threshold tracking: qué thresholds ya se notificaron por sesión ──
const contextThresholdsFired = new Map<string, Set<number>>()
const CONTEXT_THRESHOLDS = [50, 75, 90] as const

// ─── Session cost alert: sesiones que ya recibieron notificación ───────────────
const sessionCostAlertFired = new Set<string>()

// ─── Memory leak bounds ────────────────────────────────────────────────────────
const AGENT_CWD_TTL_MS   = 30 * 60_000  // entries older than 30min can't be valid parents
const TAGGED_PARENTS_MAX = 500           // prevent unbounded growth over long daemon runs

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

function extractTextPreview(transcriptPath: string): string | undefined {
  try {
    const size = fs.statSync(transcriptPath).size
    const readSize = Math.min(size, 8192)
    const buf = Buffer.alloc(readSize)
    const fd  = fs.openSync(transcriptPath, 'r')
    fs.readSync(fd, buf, 0, readSize, Math.max(0, size - readSize))
    fs.closeSync(fd)

    const lines = buf.toString('utf8').split('\n').filter(l => l.trim())
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i])
        const data = obj.message ?? obj
        if (data.role !== 'assistant') continue
        let text = ''
        if (typeof data.content === 'string') {
          text = data.content
        } else if (Array.isArray(data.content)) {
          text = data.content.find((c: any) => c.type === 'text')?.text ?? ''
        }
        text = text.replace(/\s+/g, ' ').trim()
        if (!text) continue
        return text.length > 120 ? text.slice(0, 120) + '…' : text
      } catch {}
    }
  } catch {}
  return undefined
}

eventsRouter.post('/event', (req: Request, res: Response) => {
  const ip = req.ip ?? '127.0.0.1'
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many requests — wait 1 minute' })
    return
  }

  const { type, session_id, tool_name, tool_input, tool_response, ts, cwd, transcript_path, source: rawSource } = req.body

  if (!session_id || !type) {
    res.status(400).json({ error: 'Missing session_id or type' })
    return
  }

  const KNOWN_SOURCES = new Set(['claude-code', 'opencode', 'codex', 'amp', 'droid', 'codebuff'])
  const source = rawSource && KNOWN_SOURCES.has(rawSource) ? rawSource : 'claude-code'

  const resolvedCwd = cwd
    ?? (transcript_path ? path.dirname(transcript_path) || undefined : undefined)

  dbOps.upsertSession({ id: session_id, cwd: resolvedCwd, started_at: ts, last_event_at: ts, source })

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
      ? rawResp.slice(0, 4000) + `\n…[truncated: ${rawResp.length} chars]`
      : rawResp
    broadcast({ type: 'event', payload: { type: 'Done', session_id, tool_name, tool_input: tool_input != null ? JSON.stringify(tool_input) : undefined, tool_output, ts, pairedId, skill_parent: skillParent } })

    // Activar skill parent para los eventos siguientes si este fue un Skill Done
    if (tool_name === 'Skill') {
      try {
        const inp = typeof tool_input === 'object' ? tool_input : (typeof tool_input === 'string' ? JSON.parse(tool_input) : {})
        activeSkillBySession.set(session_id, inp?.skill || inp?.name || 'skill')
      } catch { activeSkillBySession.set(session_id, 'skill') }
    }
  } else {
    const stopPreview = type === 'Stop'
      ? (() => {
          const lam = req.body.last_assistant_message
          if (lam && typeof lam === 'string') {
            const t = lam.replace(/\s+/g, ' ').trim()
            return t.length > 2000 ? t.slice(0, 2000) + '…' : t
          }
          return transcript_path ? extractTextPreview(transcript_path) : undefined
        })()
      : undefined
    dbOps.insertEvent({
      session_id, type,
      tool_name: tool_name ?? undefined,
      tool_input: tool_input ? JSON.stringify(tool_input) : (stopPreview ?? undefined),
      ts, cwd: resolvedCwd, skill_parent: skillParent, source
    })
    broadcast({ type: 'event', payload: { ...req.body, skill_parent: skillParent, ...(stopPreview ? { text_preview: stopPreview } : {}) } })

    // Stop limpia el skill activo para esta sesión
    if (type === 'Stop') {
      activeSkillBySession.delete(session_id)
      cleanupSession(session_id)
    }

    // Registrar Agent PreToolUse para detección de sub-sesiones
    if (type === 'PreToolUse' && tool_name === 'Agent' && resolvedCwd) {
      const cwdCutoff = Date.now() - AGENT_CWD_TTL_MS
      for (const [cwd, info] of lastAgentByCwd) {
        if (info.pre_ts < cwdCutoff) lastAgentByCwd.delete(cwd)
      }
      lastAgentByCwd.set(resolvedCwd, { pre_ts: ts, session_id })
    }
  }

  // Intentar etiquetar la sesión con su proyecto (solo en eventos de herramientas de archivo)
  const FILE_TOOLS = new Set(['Read','Write','Edit','Glob','Grep'])
  if (FILE_TOOLS.has(tool_name || '') && tool_input) {
    try {
      const inp      = typeof tool_input === 'string' ? JSON.parse(tool_input) : (tool_input ?? {})
      const filePath = inp?.file_path ?? inp?.path
      if (typeof filePath === 'string' && path.isAbsolute(filePath)) {
        const projectCwd = findProjectCwdForFile(filePath)
        if (projectCwd) dbOps.updateSessionProject(session_id, projectCwd)

        // Auto-declare intent for write tools when no active intent exists yet
        if (type === 'PreToolUse' && ['Write','Edit'].includes(tool_name || '')) {
          if (!dbOps.hasActiveIntent(source, filePath)) {
            const conflicts = dbOps.getWriteConflicts([filePath], source)
            if (conflicts.length === 0) {
              const aid = dbOps.insertIntent(source, session_id, 'auto: ' + tool_name)
              dbOps.insertIntentFile(aid, filePath, 'write')
              broadcast({ type: 'intent_declared', payload: { tool: source, files: [filePath], task: 'auto: ' + tool_name } })
            }
          }
        }
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
      setImmediate(() => {
        (async () => {
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
          } catch (err) { console.error('[events] Summary error:', err) }
        })()
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
export const onCostUpdate: CostUpdateCallback = (sessionId, cost, source) => {
  // Ensure session row exists — sub-agent JSONLs arrive from the enricher without a
  // prior hook event (Claude Code does not fire hooks for sub-agent sessions).
  dbOps.upsertSession({ id: sessionId, cwd: undefined, started_at: cost.firstTs ?? Date.now(), last_event_at: cost.lastTs ?? cost.firstTs ?? Date.now(), source })
  let sessionRow = dbOps.getSession(sessionId)

  // Sub-agent detection: first time we see a session, check if its firstTs falls after
  // a recent Agent PreToolUse from another session in the same CWD → tag as child.
  if (!taggedSessionParents.has(sessionId) && cost.firstTs) {
    taggedSessionParents.add(sessionId)
    if (taggedSessionParents.size > TAGGED_PARENTS_MAX) {
      const arr = Array.from(taggedSessionParents)
      for (const id of arr.slice(0, arr.length >> 1)) taggedSessionParents.delete(id)
    }
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

  dbOps.updateSessionCost(
    sessionId, cost,
    report.efficiencyScore, report.loops.length,
    report.exactRetries, report.errorRate, report.fileChurnScore, report.seqCycleCount,
  )

  // ─── Predictive saturation ────────────────────────────────────────────────────
  if (cost.context_used > 0 && cost.context_window > 0) {
    const samples = contextSamples.get(sessionId) ?? []
    samples.push({ ts: Date.now(), context_used: cost.context_used })
    if (samples.length > CONTEXT_SAMPLES_MAX) samples.shift()
    contextSamples.set(sessionId, samples)

    const prediction = predictSaturation(samples, cost.context_window)
    if (prediction && prediction.minutesLeft <= SATURATION_WARN_MINUTES) {
      const lastFired = saturationCooldown.get(sessionId) ?? 0
      if (Date.now() - lastFired >= SATURATION_COOLDOWN_MS) {
        saturationCooldown.set(sessionId, Date.now())
        broadcast({
          type: 'saturation_warning',
          payload: {
            session_id:   sessionId,
            minutes_left: prediction.minutesLeft,
            pct_per_min:  prediction.pctPerMin,
            context_used: cost.context_used,
            context_window: cost.context_window,
          }
        })
      }
    }

    // ─── Context percentage threshold alerts ──────────────────────────────────
    if (cost.context_window > 0) {
      const pct = Math.round((cost.context_used / cost.context_window) * 100)
      if (pct >= 50) {
        let fired = contextThresholdsFired.get(sessionId)
        if (!fired) {
          fired = new Set()
          contextThresholdsFired.set(sessionId, fired)
        }
        for (const th of CONTEXT_THRESHOLDS) {
          if (pct >= th && !fired.has(th)) {
            fired.add(th)
            sendDesktopNotification(
              `claudestat — Context at ${th}%`,
              `${cost.context_used.toLocaleString()} / ${cost.context_window.toLocaleString()} tokens (${pct}%) — session ${sessionId.slice(0, 8)}`
            )
            broadcast({
              type: 'context_threshold',
              payload: { session_id: sessionId, pct, threshold: th, context_used: cost.context_used, context_window: cost.context_window }
            })
          }
        }
      }
    }
  }

  const startedAt = sessionRow?.started_at ?? Date.now()
  const sessionDurationMinutes = (Date.now() - startedAt) / 60_000
  const projectedHourlyUsd = sessionDurationMinutes > 0.5
    ? cost.cost_usd / sessionDurationMinutes * 60
    : 0

  const sessionSource = sessionRow?.source ?? 'claude-code'

  broadcast({
    type: 'cost_update',
    payload: {
      session_id:            sessionId,
      source:                sessionSource,
      started_at:            startedAt,
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

  // ─── Session cost alert: notificar si la sesión supera el límite configurado ──
  const cfg = readConfig()
  if (cfg.alertsEnabled && cfg.sessionCostLimitUsd > 0 && cost.cost_usd >= cfg.sessionCostLimitUsd && !sessionCostAlertFired.has(sessionId)) {
    sessionCostAlertFired.add(sessionId)
    sendDesktopNotification(
      'claudestat — Session cost limit reached',
      `Session cost: $${cost.cost_usd.toFixed(2)} — limit $${cfg.sessionCostLimitUsd.toFixed(2)} reached`
    )
  }

  // ─── Loop alert: notificación de escritorio si hay loops activos ─────────────
  if (cfg.alertsEnabled && report.loops.length > 0) {
    const now = Date.now()
    for (const loop of report.loops) {
      const key      = `${loop.toolName}:${sessionId}`
      const lastSent = loopAlertCooldown.get(key) ?? 0
      if (now - lastSent >= LOOP_ALERT_COOLDOWN_MS) {
        loopAlertCooldown.set(key, now)
        sendDesktopNotification(
          'claudestat — Loop detected',
          `${loop.toolName} called ${loop.count}× in 2min — session may be stuck`
        )
      }
    }
  }

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

    // Semantic extraction: debounced 3s so rapid updates don't cause duplicate parses
    const existing = semanticDebounce.get(sessionId)
    if (existing) clearTimeout(existing)
    semanticDebounce.set(sessionId, setTimeout(async () => {
      semanticDebounce.delete(sessionId)
      try {
        const filePath = await findJSONLForSession(sessionId)
        if (!filePath) return
        const semantic = await extractSemanticData(filePath)
        if (!semantic) return
        dbOps.upsertAssistantTurns(sessionId, semantic.turns)
        const semLoops = analyzeSemanticLoops(semantic.turns)
        dbOps.updateSessionSemantic(sessionId, semantic.avg_output_chars, semantic.error_block_count, semLoops.length)
        if (semLoops.length > 0) {
          broadcast({ type: 'semantic_loop', payload: { session_id: sessionId, loops: semLoops } })
        }
      } catch (err) { console.warn('[events] Semantic extraction error:', err) }
    }, 3_000))
  }
}

// ─── Callback de auto-compact ────────────────────────────────────────────────

export const onCompactDetected: CompactDetectedCallback = (sessionId) => {
  broadcast({ type: 'compact_detected', payload: { session_id: sessionId, ts: Date.now() } })
  console.log(`[daemon] Auto-compact detected for session ${sessionId.slice(0, 8)}`)
}

// Exponer callback para que stream.ts pueda inyectarlo en processLatestForSession
export { processLatestForSession }

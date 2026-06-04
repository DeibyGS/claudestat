import path from 'path'
import fs   from 'fs'
import os   from 'os'
import { execSync } from 'child_process'
import { Router, type Request, type Response } from 'express'
import { getOpencodeDir } from '../paths'

export const orchestrationRouter = Router()

const AI_COLLAB_DIR = path.join(os.homedir(), '.ai-collab')
const ORCH_LOG_FILE = path.join(AI_COLLAB_DIR, 'orchestrate.log')
const PROJECTS_JSON  = path.join(getOpencodeDir(), 'projects.json')

interface WorkflowJson {
  version?:             number
  goal?:                string
  project?:             string
  current_phase?:       string | null
  phase_status?:        string
  phase_retry_count?:   number
  waiting_for_user?:    boolean
  total_cycles?:        number
  created_at?:          string
  last_verified_ts?:    number
  tsc_passed?:          string | boolean
  tests_passed?:        string | boolean
}

interface OrchEvent {
  ts:            string
  full_ts:       number
  tool:          'cc' | 'oc'
  action:        'planning' | 'executing' | 'reviewing' | 'correcting' | 'done' | 'error' | 'timeout' | 'paused'
  phase:         string | null
  description:   string
  duration_secs: number | null
  retry_count:   number | null
  verified:      boolean | null
}

interface OrchCycleTrace {
  action_detail: 'planning' | 'reviewing' | 'escalation' | 'correction' | null
  files_changed: string[]
  git_commit: string | null
  skills_used: string[]
  verification: {
    tsc_passed: boolean | null
    tests_passed: boolean | null
    grep_checks: { pattern: string; result: string }[]
  } | null
  disagreements: number
  disagreement_texts: string[]
  simplifications: number
  artifacts: string[]
}

interface OrchCycle {
  index:            number
  cc_events:        OrchEvent[]
  oc_events:        OrchEvent[]
  status:           'success' | 'verify_failed' | 'active' | 'error' | 'paused'
  duration_secs:    number | null
  verified:         boolean | null
  label:            string
  cc_action:        string | null
  oc_action:        string | null
  trace:            OrchCycleTrace
}

interface OrchDetail {
  project_path:   string
  project_name:   string
  goal:           string
  status:         'active' | 'paused' | 'complete' | 'none'
  current_phase:  string | null
  total_phases:   number
  completed:      number
  phase_retry:    number
  waiting_for_user: boolean
  tsc_passed:     boolean | null
  tests_passed:   boolean | null
  started_at:     string | null
  cc_events:      OrchEvent[]
  oc_events:      OrchEvent[]
  cycles:         OrchCycle[]
}

let _cache: { data: OrchDetail | null; ts: number; projectPath: string } = { data: null, ts: 0, projectPath: '' }
const CACHE_TTL_MS = 2_000

function findActiveOrchestration(): { projectPath: string; projectName: string; wf: WorkflowJson } | null {
  try {
    const raw = fs.readFileSync(PROJECTS_JSON, 'utf-8')
    const parsed = JSON.parse(raw)
    const projects: Record<string, { path: string }> = parsed?.projects ?? {}
    const candidates: Array<{ projectPath: string; projectName: string; wf: WorkflowJson; recentTs: number }> = []
    for (const [name, p] of Object.entries(projects)) {
      if (!p?.path) continue
      const wfPath = path.join(p.path, 'workflow.json')
      try {
        const wfRaw = fs.readFileSync(wfPath, 'utf-8')
        const wf: WorkflowJson = JSON.parse(wfRaw)
        if (wf?.version && wf.version >= 2 && wf?.phase_status) {
          const recentTs = Math.max(
            typeof wf.last_verified_ts === 'number' ? wf.last_verified_ts : 0,
            typeof wf.created_at === 'string' ? new Date(wf.created_at).getTime() : 0,
          )
          candidates.push({ projectPath: p.path, projectName: name, wf, recentTs })
        }
      } catch {}
    }
    if (candidates.length === 0) return null
    candidates.sort((a, b) => b.recentTs - a.recentTs)
    return { projectPath: candidates[0].projectPath, projectName: candidates[0].projectName, wf: candidates[0].wf }
  } catch {}
  return null
}

function parseLog(sinceTs?: number): { cc: OrchEvent[]; oc: OrchEvent[] } {
  const ccEvents: OrchEvent[] = []
  const ocEvents: OrchEvent[] = []
  const lines = readLogLines(5000)
  if (lines.length === 0) return { cc: ccEvents, oc: ocEvents }

  let currentCC: Partial<OrchEvent> | null = null
  let currentOC: Partial<OrchEvent> | null = null

  for (const line of lines) {
    const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/)
    if (!tsMatch) continue
    const tsStr = tsMatch[1]
    const timeLabel = tsStr.slice(11, 19)
    const fullTs = new Date(tsStr.replace(' ', 'T') + 'Z').getTime()
    if (sinceTs !== undefined && fullTs < sinceTs) continue

    const phaseName = (() => {
      const m = line.match(/Fase (\d+)\s*[—–-]\s*(.+?)(?:\s{2,}|$)/)
      return m ? `Fase ${m[1]} — ${m[2].trim()}` : null
    })()

    if (line.includes('CC ▶') || line.includes('CC ▶ intento')) {
      currentCC = { ts: timeLabel, full_ts: fullTs, tool: 'cc', action: 'planning', phase: null, description: '', duration_secs: null, retry_count: null, verified: null }

      if (line.includes('Revisando OC-REPORT')) {
        currentCC.action = 'reviewing'
        currentCC.description = 'Revisando OC-REPORT.md'
      } else if (line.includes('Análisis inicial')) {
        currentCC.action = 'planning'
        currentCC.description = 'Analizando objetivo — escribiendo SPEC.md'
      } else if (line.includes('procesando escalación')) {
        currentCC.action = 'reviewing'
        currentCC.description = 'Procesando respuesta del usuario (DOUBTS.md)'
      } else {
        currentCC.action = 'planning'
        currentCC.description = 'CC iniciando análisis...'
      }
    }

    if (line.includes('CC ✓')) {
      if (currentCC) {
        currentCC.action = 'done'
        currentCC.duration_secs = Math.round((fullTs - currentCC.full_ts!) / 1000)
        const info = currentCC.description || ''
        if (info.includes('SPEC.md')) currentCC.description = 'SPEC.md + OC-TASK.md listos'
        else if (info.includes('OC-REPORT')) currentCC.description = 'Revisión completada — siguiente fase lista'
        else if (info.includes('escalación')) currentCC.description = 'Respuesta del usuario procesada'
        else currentCC.description = 'CC completado'
        currentCC.phase = phaseName
        ccEvents.push(currentCC as OrchEvent)
        currentCC = null
      }
    }

    if (line.includes('CC ✗')) {
      if (currentCC) {
        currentCC.action = 'error'
        currentCC.description = 'CC falló — reintentando...'
        currentCC.retry_count = (line.match(/intento (\d+)/) || [])[1] ? parseInt(line.match(/intento (\d+)/)![1], 10) : null
        ccEvents.push(currentCC as OrchEvent)
        currentCC = null
      } else {
        const retryMatch = line.match(/intento (\d+)/)
        const failDesc = line.includes('AGOTADO')
          ? 'CC agotado — máx intentos alcanzados'
          : 'CC falló'
        ccEvents.push({
          ts: timeLabel, full_ts: fullTs, tool: 'cc', action: 'error',
          phase: phaseName, description: failDesc,
          duration_secs: null,
          retry_count: retryMatch ? parseInt(retryMatch[1], 10) : null,
          verified: null,
        })
      }
    }

    if (line.includes('ESPERANDO USUARIO')) {
      ccEvents.push({
        ts: timeLabel, full_ts: fullTs, tool: 'cc', action: 'paused',
        phase: phaseName, description: 'Esperando respuesta del usuario — DOUBTS.md',
        duration_secs: null, retry_count: null, verified: null,
      })
    }

    if (line.includes('OC ▶')) {
      currentOC = { ts: timeLabel, full_ts: fullTs, tool: 'oc', action: 'executing', phase: null, description: '', duration_secs: null, retry_count: null, verified: null }

      const yoloMatch = line.match(/yolo:\s*(true|false)/)
      const timeoutMatch = line.match(/timeout:\s*(\d+)min/)
      const yolo = yoloMatch ? yoloMatch[1] === 'true' : false
      const timeout = timeoutMatch ? timeoutMatch[1] : '?'
      currentOC.description = `Ejecutando fase${yolo ? ' (yolo)' : ''} · timeout ${timeout}min`
    }

    if (line.includes('OC ✓')) {
      if (currentOC) {
        currentOC.action = 'done'
        currentOC.phase = phaseName
        currentOC.duration_secs = Math.round((fullTs - currentOC.full_ts!) / 1000)
        currentOC.description = `Fase completada${currentOC.phase ? ': ' + currentOC.phase : ''}`
        ocEvents.push(currentOC as OrchEvent)
        currentOC = null
      } else {
        ocEvents.push({
          ts: timeLabel, full_ts: fullTs, tool: 'oc', action: 'done',
          phase: phaseName, description: 'OC terminado',
          duration_secs: null, retry_count: null, verified: null,
        })
      }
    }

    if (line.includes('OC ✗')) {
      if (currentOC) {
        if (line.includes('TIMEOUT')) {
          currentOC.action = 'timeout'
          currentOC.description = 'OC superó el timeout'
        } else {
          currentOC.action = 'error'
          currentOC.description = 'OC terminó con error'
        }
        currentOC.phase = phaseName
        ocEvents.push(currentOC as OrchEvent)
        currentOC = null
      } else {
        if (line.includes('TIMEOUT')) {
          ocEvents.push({
            ts: timeLabel, full_ts: fullTs, tool: 'oc', action: 'timeout',
            phase: phaseName, description: 'OC superó el tiempo límite',
            duration_secs: null, retry_count: null, verified: null,
          })
        } else {
          ocEvents.push({
            ts: timeLabel, full_ts: fullTs, tool: 'oc', action: 'error',
            phase: phaseName, description: 'OC falló',
            duration_secs: null, retry_count: null, verified: null,
          })
        }
      }
    }

    if (line.includes('verify_phase.sh passed')) {
      const lastOC = ocEvents[ocEvents.length - 1]
      if (lastOC && lastOC.action === 'done') {
        lastOC.verified = true
        lastOC.description += ' · ✅ verify OK'
      }
    }
    if (line.includes('verify_phase.sh FAILED')) {
      const lastOC = ocEvents[ocEvents.length - 1]
      if (lastOC && lastOC.action === 'done') {
        lastOC.verified = false
        lastOC.description += ' · ❌ verify FAILED'
      }
    }

    const corrMatch = line.match(/Corrección #(\d+)/)
    if (corrMatch && line.includes('OC')) {
      ocEvents.push({
        ts: timeLabel, full_ts: fullTs, tool: 'oc', action: 'correcting',
        phase: phaseName,
        description: `Corrigiendo (intento ${corrMatch[1]})`,
        duration_secs: null,
        retry_count: parseInt(corrMatch[1], 10),
        verified: null,
      })
    }
  }

  if (currentCC) {
    currentCC.description = currentCC.description || 'CC en progreso...'
    ccEvents.push(currentCC as OrchEvent)
  }
  if (currentOC) {
    currentOC.description = currentOC.description || 'OC en progreso...'
    ocEvents.push(currentOC as OrchEvent)
  }

  for (const events of [ccEvents, ocEvents]) {
    let lastPhase: string | null = null
    for (const ev of events) {
      if (ev.phase) lastPhase = ev.phase
      if (!ev.phase && lastPhase) ev.phase = lastPhase
    }
  }

  return { cc: ccEvents, oc: ocEvents }
}

function readLogLines(maxLines: number): string[] {
  try {
    if (!fs.existsSync(ORCH_LOG_FILE)) return []
    const content = fs.readFileSync(ORCH_LOG_FILE, 'utf-8')
    const allLines = content.split('\n')
    const timestamped: string[] = []
    for (let i = allLines.length - 1; i >= 0 && timestamped.length < maxLines; i--) {
      if (/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/.test(allLines[i])) {
        timestamped.unshift(allLines[i])
      }
    }
    return timestamped
  } catch {
    return []
  }
}

function readAllLogLines(maxLines: number): string[] {
  try {
    if (!fs.existsSync(ORCH_LOG_FILE)) return []
    const content = fs.readFileSync(ORCH_LOG_FILE, 'utf-8')
    const allLines = content.split('\n')
    return allLines.length > maxLines ? allLines.slice(-maxLines) : allLines
  } catch {
    return []
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[0m|\[90m/g, '')
}

function extractTraceForRange(startTs: number, endTs: number, tool: 'cc' | 'oc', projectPath: string): OrchCycleTrace {
  const allLines = readAllLogLines(200_000)
  const startMarker = tool === 'oc' ? 'OC ▶' : 'CC ▶'
  const endMarkers  = tool === 'oc' ? ['OC ✓', 'OC ✗'] : ['CC ✓', 'CC ✗']

  // Find line indices by matching timestamp + marker
  let startIdx = -1
  let endIdx   = -1
  for (let i = 0; i < allLines.length; i++) {
    const tsMatch = allLines[i].match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/)
    if (!tsMatch) continue
    const lTs = new Date(tsMatch[1].replace(' ', 'T') + 'Z').getTime()
    if (startIdx === -1 && allLines[i].includes(startMarker) && Math.abs(lTs - startTs) <= 2000) {
      startIdx = i
    } else if (startIdx !== -1 && endMarkers.some(m => allLines[i].includes(m)) && Math.abs(lTs - endTs) <= 2000) {
      endIdx = i
      break
    }
  }

  const emptyTrace = (): OrchCycleTrace => ({
    action_detail: null, files_changed: [], git_commit: null,
    skills_used: [], verification: null, disagreements: 0, disagreement_texts: [], simplifications: 0, artifacts: [],
  })
  if (startIdx === -1) return emptyTrace()
  if (endIdx === -1) endIdx = Math.min(startIdx + 5000, allLines.length - 1)

  const trace = emptyTrace()
  let tscResult:   boolean | null = null
  let testsResult: boolean | null = null
  const grepChecks: { pattern: string; result: string }[] = []

  for (const raw of allLines.slice(startIdx, endIdx + 1)) {
    const line = stripAnsi(raw).trim()

    // action_detail
    if (tool === 'cc') {
      if      (line.includes('Revisando OC-REPORT'))    trace.action_detail = 'reviewing'
      else if (line.includes('Análisis inicial'))        trace.action_detail = 'planning'
      else if (line.includes('procesando escalación'))   trace.action_detail = 'escalation'
      else if (line.includes('CC ▶') && !trace.action_detail) trace.action_detail = 'planning'
    } else {
      if (line.includes('OC ▶') && !trace.action_detail) trace.action_detail = 'correction'
    }

    // Files edited/written — split into artifacts (specs/) vs source files
    const fileOpMatch = line.match(/^[←]\s+(?:Edit|Write)\s+(.+)$/)
    if (fileOpMatch) {
      const fp = fileOpMatch[1].trim()
      const isSpec = fp.startsWith('specs/') || fp.includes('/specs/')
      if (isSpec) trace.artifacts.push(path.basename(fp))
      else if (!fp.startsWith('/') || fp.startsWith(projectPath)) trace.files_changed.push(fp)
    }

    // Known artifact filenames mentioned in any line
    if (line.includes('SPEC.md'))    trace.artifacts.push('SPEC.md')
    if (line.includes('OC-TASK.md')) trace.artifacts.push('OC-TASK.md')
    if (line.includes('OC-REPORT.md')) trace.artifacts.push('OC-REPORT.md')
    const ctxMatch = line.match(/PHASE-[A-Za-z0-9-]+-CONTEXT\.md/)
    if (ctxMatch) trace.artifacts.push(ctxMatch[0])

    // Engram saves → skills_used
    const engMatch = line.match(/engram_mem_(?:save|session_summary).*?"title"\s*:\s*"([^"]+)"/)
    if (engMatch) trace.skills_used.push(engMatch[1])

    // Git commit from commit output line: [branch hash] orchestrate: ...
    const gitMatch = line.match(/\[\S+\s+([0-9a-f]{7,40})\]\s+orchestrate:/)
    if (gitMatch && !trace.git_commit) trace.git_commit = gitMatch[1]

    // TSC: look for "Found N error(s)" or inline error count
    const tscErrMatch = line.match(/Found (\d+) error/)
    if (tscErrMatch) tscResult = parseInt(tscErrMatch[1]) === 0
    if (/error TS\d+:/.test(line)) tscResult = false

    // Tests: vitest summary line "Tests  N passed (N)"
    if (/^\s*Tests\s+(\d+) passed \((\d+)\)/.test(line)) {
      const m = line.match(/Tests\s+(\d+) passed \((\d+)\)/)!
      testsResult = parseInt(m[1]) === parseInt(m[2])
    }
    if (/\bfailed\b/.test(line) && /\bTests?\b/.test(line)) testsResult = false

    // verify_phase.sh
    if (line.includes('verify_phase.sh passed')) { tscResult = true;  testsResult = true  }
    if (line.includes('verify_phase.sh FAILED'))  { tscResult = false; testsResult = false }

    // Grep checks: "grep -c 'pattern' ... → N"
    const grepM = line.match(/grep.*?["']([^"']+)["'].*?[→>]\s*(\d+)/)
    if (grepM) grepChecks.push({ pattern: grepM[1], result: grepM[2] })

    // Disagreements + simplifications
    const disagMatch = line.match(/\[?DISAGREEMENT\]?\s*[:\-]?\s*(.+)/)
    if (disagMatch) {
      trace.disagreements++
      const text = disagMatch[1].trim()
      if (text.length > 3) trace.disagreement_texts.push(text.slice(0, 120))
    }
    if (line.includes('[SIMPLIFIED]') || /\bsimplify:/.test(line)) trace.simplifications++
  }

  trace.artifacts    = [...new Set(trace.artifacts)]
  trace.skills_used  = [...new Set(trace.skills_used)]
  trace.files_changed = [...new Set(trace.files_changed)]

  if (tscResult !== null || testsResult !== null || grepChecks.length > 0) {
    trace.verification = { tsc_passed: tscResult, tests_passed: testsResult, grep_checks: grepChecks }
  }

  // If git_commit found, use git show --stat as authoritative source for files_changed
  if (trace.git_commit && projectPath) {
    try {
      const out = execSync(`git show --stat --format="" ${trace.git_commit}`, { cwd: projectPath, timeout: 5000 }).toString()
      const fileMatches = out.match(/^[ \t]+(.+)/gm)
      if (fileMatches) {
        trace.files_changed = fileMatches.map(f => f.trim().split('|')[0].trim()).filter(f => f && !f.includes('=>'))
        const insMatch = out.match(/(\d+) insertion/)
        const delMatch = out.match(/(\d+) deletion/)
        if (insMatch) trace.files_changed.push(`+${insMatch[1]}`)
        if (delMatch) trace.files_changed.push(`-${delMatch[1]}`)
      }
    } catch {}
  }

  return trace
}

function buildCycles(cc: OrchEvent[], oc: OrchEvent[], projectPath: string, specPhases: string[]): OrchCycle[] {
  type TaggedEvent = OrchEvent & { _tool: 'cc' | 'oc' }
  const all: TaggedEvent[] = [
    ...cc.map(e => ({ ...e, _tool: 'cc' as const })),
    ...oc.map(e => ({ ...e, _tool: 'oc' as const })),
  ]
  all.sort((a, b) => a.full_ts - b.full_ts)
  if (all.length === 0) return []

  const groups: Array<{ tool: 'cc' | 'oc'; events: OrchEvent[] }> = []
  let currentTool: 'cc' | 'oc' | null = null
  let currentGroup: OrchEvent[] = []

  for (const ev of all) {
    if (ev._tool !== currentTool) {
      if (currentGroup.length > 0 && currentTool !== null) {
        groups.push({ tool: currentTool, events: [...currentGroup] })
      }
      currentGroup = [ev]
      currentTool = ev._tool
    } else {
      currentGroup.push(ev)
    }
  }
  if (currentGroup.length > 0 && currentTool !== null) {
    groups.push({ tool: currentTool, events: currentGroup })
  }

  const cycles: OrchCycle[] = []
  let i = 0
  let cycleIdx = 1
  while (i < groups.length) {
    const ccGroup = groups[i]?.tool === 'cc' ? groups[i] : null
    const ocGroup = groups[i + 1]?.tool === 'oc' ? groups[i + 1] : null

    const phaseFromEvents = (evts: OrchEvent[]): string | null => {
      for (const e of evts) { if (e.phase) return e.phase }
      return null
    }
    const resolveLabel = (phase: string | null, idx: number): string => {
      if (phase) return phase
      const phaseMatch = phase?.match(/Fase\s+(\d+)/)
      if (phaseMatch) {
        const pn = parseInt(phaseMatch[1], 10)
        if (specPhases[pn - 1]) return specPhases[pn - 1]
      }
      if (specPhases[idx - 1]) return specPhases[idx - 1]
      return `Cycle ${idx}`
    }

    if (ccGroup && ocGroup) {
      const ccDur = ccGroup.events.reduce((s, e) => s + (e.duration_secs ?? 0), 0)
      const ocDur = ocGroup.events.reduce((s, e) => s + (e.duration_secs ?? 0), 0)
      const hasError = ccGroup.events.some(e => e.action === 'error') || ocGroup.events.some(e => e.action === 'error' || e.action === 'timeout')
      const ocVerified = ocGroup.events[ocGroup.events.length - 1]?.verified ?? null
      const ccActions = [...new Set(ccGroup.events.map(e => e.action))]
      const ocActions = [...new Set(ocGroup.events.map(e => e.action))]
      const isVerifyFailed = ocVerified === false
      const phase = phaseFromEvents(ccGroup.events) ?? phaseFromEvents(ocGroup.events)

      const ccStart = ccGroup.events[0].full_ts
      const ccEnd = ccGroup.events[ccGroup.events.length - 1].full_ts
      const ccTrace = extractTraceForRange(ccStart, ccEnd, 'cc', projectPath)
      const ocStart = ocGroup.events[0].full_ts
      const ocEnd = ocGroup.events[ocGroup.events.length - 1].full_ts
      const ocTrace = extractTraceForRange(ocStart, ocEnd, 'oc', projectPath)

      const mergedTrace: OrchCycleTrace = {
        action_detail: ccTrace.action_detail,
        files_changed: [...new Set([...ccTrace.files_changed, ...ocTrace.files_changed])],
        git_commit: ocTrace.git_commit ?? ccTrace.git_commit,
        skills_used: [...new Set([...ccTrace.skills_used, ...ocTrace.skills_used])],
        verification: ocTrace.verification ?? ccTrace.verification,
        disagreements: ccTrace.disagreements + ocTrace.disagreements,
        disagreement_texts: [...ccTrace.disagreement_texts, ...ocTrace.disagreement_texts],
        simplifications: ccTrace.simplifications + ocTrace.simplifications,
        artifacts: [...new Set([...ccTrace.artifacts, ...ocTrace.artifacts])],
      }

      cycles.push({
        index: cycleIdx++,
        cc_events: ccGroup.events,
        oc_events: ocGroup.events,
        status: hasError ? 'error' : isVerifyFailed ? 'verify_failed' : 'success',
        duration_secs: ccDur + ocDur > 0 ? ccDur + ocDur : null,
        verified: ocVerified,
        label: resolveLabel(phase, cycleIdx - 1),
        cc_action: ccActions.join('+'),
        oc_action: ocActions.join('+'),
        trace: mergedTrace,
      })
      i += 2
    } else if (ccGroup && !ocGroup) {
      const hasError = ccGroup.events.some(e => e.action === 'error')
      const ccActions = [...new Set(ccGroup.events.map(e => e.action))]
      const ccDur = ccGroup.events.reduce((s, e) => s + (e.duration_secs ?? 0), 0)
      const phase = phaseFromEvents(ccGroup.events)

      const ccStart = ccGroup.events[0].full_ts
      const ccEnd = ccGroup.events[ccGroup.events.length - 1].full_ts
      const ccTrace = extractTraceForRange(ccStart, ccEnd, 'cc', projectPath)

      cycles.push({
        index: cycleIdx++,
        cc_events: ccGroup.events,
        oc_events: [],
        status: hasError ? 'error' : 'active',
        duration_secs: ccDur > 0 ? ccDur : null,
        verified: null,
        label: resolveLabel(phase, cycleIdx - 1),
        cc_action: ccActions.join('+'),
        oc_action: null,
        trace: ccTrace,
      })
      i += 1
    } else if (!ccGroup && ocGroup) {
      const ocActions = [...new Set(ocGroup.events.map(e => e.action))]
      const ocDur = ocGroup.events.reduce((s, e) => s + (e.duration_secs ?? 0), 0)
      const isVerifyFailed = ocGroup.events[ocGroup.events.length - 1]?.verified === false
      const phase = phaseFromEvents(ocGroup.events)

      const ocStart = ocGroup.events[0].full_ts
      const ocEnd = ocGroup.events[ocGroup.events.length - 1].full_ts
      const ocTrace = extractTraceForRange(ocStart, ocEnd, 'oc', projectPath)

      cycles.push({
        index: cycleIdx++,
        cc_events: [],
        oc_events: ocGroup.events,
        status: isVerifyFailed ? 'verify_failed' : 'active',
        duration_secs: ocDur > 0 ? ocDur : null,
        verified: ocGroup.events[ocGroup.events.length - 1]?.verified ?? null,
        label: resolveLabel(phase, cycleIdx - 1),
        cc_action: null,
        oc_action: ocActions.join('+'),
        trace: ocTrace,
      })
      i += 1
    } else {
      i += 1
    }
  }

  return cycles
}

function parseSpecPhases(projectPath: string): string[] {
  const specPath = path.join(projectPath, 'specs', 'SPEC.md')
  try {
    const content = fs.readFileSync(specPath, 'utf-8')
    const matches = [...content.matchAll(/^###\s+(Fase\s+\d+\s*[—–-]\s*.+)$/gm)]
    return matches.map(m => m[1].trim())
  } catch {}
  return []
}

orchestrationRouter.get('/api/orchestration/timeline', (_req: Request, res: Response) => {
  try {
    const active = findActiveOrchestration()
    if (!active) {
      res.json({ status: 'none', project_path: null, project_name: null, goal: '', current_phase: null, total_phases: 0, completed: 0, phase_retry: 0, waiting_for_user: false, tsc_passed: null, tests_passed: null, started_at: null, cc_events: [], oc_events: [], cycles: [] })
      return
    }

    if (_cache.data && _cache.projectPath === active.projectPath && Date.now() - _cache.ts < CACHE_TTL_MS) {
      res.json(_cache.data)
      return
    }

    const wf = active.wf
    let totalPhases = 0
    const specPath = path.join(active.projectPath, 'specs', 'SPEC.md')
    try {
      const specContent = fs.readFileSync(specPath, 'utf-8')
      const phaseMatches = specContent.match(/^###\s+Fase\s+\d+/gm)
      totalPhases = phaseMatches ? phaseMatches.length : 0
    } catch {}

    const specPhases = parseSpecPhases(active.projectPath)
    const completed = wf?.total_cycles ?? 0
    const wfStartTs = wf.created_at ? new Date(wf.created_at).getTime() : undefined
    const { cc, oc } = parseLog(wfStartTs)
    const cycles = buildCycles(cc, oc, active.projectPath, specPhases)

    let status: OrchDetail['status'] = 'active'
    if (wf?.waiting_for_user) status = 'paused'
    const taskPath = path.join(active.projectPath, 'specs', 'OC-TASK.md')
    try {
      if (fs.readFileSync(taskPath, 'utf-8').trim() === 'ORCHESTRATION_COMPLETE') status = 'complete'
    } catch {}

    let currentPhase: string | null = wf?.current_phase ?? null
    for (const ev of [...oc, ...cc].reverse()) {
      if (ev.phase) { currentPhase = ev.phase; break }
    }

    const detail: OrchDetail = {
      project_path:   active.projectPath,
      project_name:   active.projectName,
      goal:           wf?.goal ?? '',
      status,
      current_phase:  currentPhase,
      total_phases:   totalPhases,
      completed:      completed,
      phase_retry:    wf?.phase_retry_count ?? 0,
      waiting_for_user: wf?.waiting_for_user ?? false,
      tsc_passed:     typeof wf.tsc_passed === 'string' ? wf.tsc_passed === 'true' : (wf.tsc_passed ?? null),
      tests_passed:   typeof wf.tests_passed === 'string' ? wf.tests_passed === 'true' : (wf.tests_passed ?? null),
      started_at:     wf?.created_at ?? null,
      cc_events:      cc,
      oc_events:      oc,
      cycles,
    }

    for (const c of detail.cycles) {
      for (const e of c.cc_events) { delete (e as any)._tool }
      for (const e of c.oc_events) { delete (e as any)._tool }
    }
    for (const e of detail.cc_events) { delete (e as any)._tool }
    for (const e of detail.oc_events) { delete (e as any)._tool }

    _cache = { data: detail, ts: Date.now(), projectPath: active.projectPath }
    res.json(detail)
  } catch (err) {
    res.json({ status: 'none', project_path: null, project_name: null, goal: '', current_phase: null, total_phases: 0, completed: 0, phase_retry: 0, waiting_for_user: false, tsc_passed: null, tests_passed: null, started_at: null, cc_events: [], oc_events: [], cycles: [] })
  }
})
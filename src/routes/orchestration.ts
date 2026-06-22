import path from 'path'
import fs   from 'fs'
import os   from 'os'
import zlib from 'zlib'
import { execSync } from 'child_process'
import { dbOps } from '../db'
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
  tsc_errors?:          string[]
  tests_errors?:        string[]
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
    tsc_errors: string[]
    tests_errors: string[]
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
  cc_cost:          number | null
  oc_cost:          number | null
  cc_input_tokens:  number | null
  cc_output_tokens: number | null
  cc_cache_tokens:  number | null
  oc_input_tokens:  number | null
  oc_output_tokens: number | null
  oc_cache_tokens:  number | null
  cc_model:         string | null
  oc_model:         string | null
  cc_tool_counts:   Record<string, number> | null
  oc_tool_counts:   Record<string, number> | null
}

interface CommandLogEntry {
  ts:        number
  command:   string
}

interface FileChangeEntry {
  ts:     number
  path:   string
  action: 'create' | 'modify' | 'delete'
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
  tsc_errors:     string[]
  tests_errors:   string[]
  started_at:     string | null
  cc_events:      OrchEvent[]
  oc_events:      OrchEvent[]
  cycles:         OrchCycle[]
  cc_total_cost:  number
  oc_total_cost:  number
  spec_files:     Record<string, string>
  command_log:    CommandLogEntry[]
  file_changes:   FileChangeEntry[]
}

let _cache: { data: OrchDetail | null; ts: number; projectPath: string } = { data: null, ts: 0, projectPath: '' }
const CACHE_TTL_MS = 2_000

function toTimestampMs(val: unknown): number {
  return typeof val === 'string' ? new Date(val).getTime() : 0
}

function getWorkflowWithFreshTs(projectPath: string): WorkflowJson | null {
  try {
    const wfPath = path.join(projectPath, 'workflow.json')
    const wf: WorkflowJson = JSON.parse(fs.readFileSync(wfPath, 'utf-8'))
    return wf
  } catch {
    return null
  }
}

function findActiveOrchestration(): { projectPath: string; projectName: string; wf: WorkflowJson } | null {
  try {
    const raw = fs.readFileSync(PROJECTS_JSON, 'utf-8')
    const parsed = JSON.parse(raw)
    const projects: Record<string, { path: string }> = parsed?.projects ?? {}
    const candidates: Array<{ projectPath: string; projectName: string; wf: WorkflowJson; recentTs: number }> = []
    for (const [name, p] of Object.entries(projects)) {
      if (!p?.path) continue
      const wf = getWorkflowWithFreshTs(p.path)
      if (!wf || !wf?.version || wf.version < 2 || !wf?.phase_status) continue

      const recentTs = Math.max(
        typeof wf.last_verified_ts === 'number' ? wf.last_verified_ts : 0,
        toTimestampMs(wf.created_at),
      )
      candidates.push({ projectPath: p.path, projectName: name, wf, recentTs })
    }
    if (candidates.length === 0) return null
    candidates.sort((a, b) => b.recentTs - a.recentTs)
    return { projectPath: candidates[0].projectPath, projectName: candidates[0].projectName, wf: candidates[0].wf }
  } catch {}
  return null
}

function parseLog(sinceTs?: number): { cc: OrchEvent[]; oc: OrchEvent[]; detectedStartTs: number | undefined; command_log: CommandLogEntry[]; file_changes: FileChangeEntry[] } {
  const ccEvents: OrchEvent[] = []
  const ocEvents: OrchEvent[] = []
  const lines = readLogLines(5000)
  if (lines.length === 0) return { cc: ccEvents, oc: ocEvents, detectedStartTs: undefined, command_log: [], file_changes: [] }

  // Find the most recent "CICLO 1 /" line — it always marks the start of a new run
  // and is more reliable than workflow.json.created_at (which CC often writes with wrong timestamps).
  let cycle1Ts: number | undefined
  for (const line of lines) {
    if (/CICLO 1 \/ /.test(line)) {
      const m = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/)
      if (m) cycle1Ts = new Date(m[1].replace(' ', 'T')).getTime()
    }
  }
  // Use cycle1Ts as sinceTs — it anchors the window to the current run only.
  // Fall back to sinceTs (wfStartTs) only when no CICLO 1 marker exists.
  if (cycle1Ts !== undefined) sinceTs = cycle1Ts

  let currentCC: Partial<OrchEvent> | null = null
  let currentOC: Partial<OrchEvent> | null = null

  for (const line of lines) {
    const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/)
    if (!tsMatch) continue
    const tsStr = tsMatch[1]
    const timeLabel = tsStr.slice(11, 19)
    const fullTs = new Date(tsStr.replace(' ', 'T')).getTime()
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

  const live = extractLiveData(sinceTs)
  return { cc: ccEvents, oc: ocEvents, detectedStartTs: cycle1Ts, command_log: live.command_log, file_changes: live.file_changes }
}

function readLogLines(maxLines: number): string[] {
  try {
    // Read current log
    const lines: string[] = []
    if (fs.existsSync(ORCH_LOG_FILE)) {
      const content = fs.readFileSync(ORCH_LOG_FILE, 'utf-8')
      for (const l of content.split('\n')) {
        if (/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/.test(l)) lines.push(l)
      }
    }

    // Prepend rotated log (.gz) if we need more lines
    if (lines.length < maxLines) {
      const gzPath = ORCH_LOG_FILE + '.1.gz'
      if (fs.existsSync(gzPath)) {
        try {
          const gz = fs.readFileSync(gzPath)
          const decompressed = zlib.gunzipSync(gz).toString('utf-8')
          const older: string[] = []
          for (const l of decompressed.split('\n')) {
            if (/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/.test(l)) older.push(l)
          }
          lines.unshift(...older)
        } catch { /* ignore corrupt/missing gz */ }
      }
    }

    // Return last maxLines timestamped lines
    return lines.length > maxLines ? lines.slice(-maxLines) : lines
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

function extractLiveData(sinceTs?: number): { command_log: CommandLogEntry[]; file_changes: FileChangeEntry[] } {
  const cmds: CommandLogEntry[] = []
  const files: FileChangeEntry[] = []
  const raw = readAllLogLines(200000)
  if (raw.length === 0) return { command_log: cmds, file_changes: files }

  let currentTs = 0
  for (const line of raw) {
    const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/)
    if (tsMatch) {
      currentTs = new Date(tsMatch[1].replace(' ', 'T') + 'Z').getTime()
    }
    if (sinceTs !== undefined && currentTs < sinceTs) continue

    const clean = stripAnsi(line).trim()

    // Commands: lines starting with $ or > after strip (OC shell commands)
    const cmdMatch = clean.match(/^[\$>]\s+(.+)/)
    if (cmdMatch) {
      cmds.push({ ts: currentTs, command: cmdMatch[1].trim() })
      continue
    }

    // File changes from tool calls
    const editMatch = clean.match(/^←\s*Edit\s+(.+)/)
    if (editMatch) {
      files.push({ ts: currentTs, path: editMatch[1].trim(), action: 'modify' })
      continue
    }
    const writeMatch = clean.match(/^←\s*Write\s+(.+)/)
    if (writeMatch) {
      files.push({ ts: currentTs, path: writeMatch[1].trim(), action: 'modify' })
      continue
    }

    // Diff new-file markers
    const diffNewMatch = clean.match(/^\+\+\+\s+(?:\S+\/)?(.+)/)
    if (diffNewMatch) {
      const fp = diffNewMatch[1].trim()
      if (!fp.startsWith('/dev/null')) files.push({ ts: currentTs, path: fp, action: 'modify' })
      continue
    }
  }

  // Deduplicate file changes (keep last per path)
  const seen = new Set<string>()
  const deduped: FileChangeEntry[] = []
  for (let i = files.length - 1; i >= 0; i--) {
    if (!seen.has(files[i].path)) { seen.add(files[i].path); deduped.unshift(files[i]) }
  }

  return { command_log: cmds.slice(-80), file_changes: deduped.slice(-80) }
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
  const grepChecks:  { pattern: string; result: string }[] = []
  const tscErrors:   string[] = []
  const testsErrors: string[] = []

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

    // Skill invocations (real skill names from log: → Skill "name")
    const skillMatch = line.match(/→\s+Skill\s+"([^"]+)"/)
    if (skillMatch) trace.skills_used.push(skillMatch[1])

    // Engram saves — only add if title looks like a skill name (not a phase label)
    const engMatch = line.match(/engram_mem_save[^}]*?"title"\s*:\s*"([^"]+)"/)
    if (engMatch && !/Fase\s+\d|completado|Ciclo|Completed|Compacted|Goal|Instructions/i.test(engMatch[1])) {
      trace.skills_used.push(engMatch[1])
    }

    // Git commit from commit output line: [branch hash] orchestrate: ...
    const gitMatch = line.match(/\[\S+\s+([0-9a-f]{7,40})\]\s+orchestrate:/)
    if (gitMatch && !trace.git_commit) trace.git_commit = gitMatch[1]

    // TSC: look for "Found N error(s)" or inline error count
    const tscErrMatch = line.match(/Found (\d+) error/)
    if (tscErrMatch) tscResult = parseInt(tscErrMatch[1]) === 0
    if (/error TS\d+:/.test(line)) {
      tscResult = false
      if (tscErrors.length < 10) tscErrors.push(line)
    }

    // Tests: vitest summary line "Tests  N passed (N)" or node:test "✗ / not ok"
    if (/^\s*Tests\s+(\d+) passed \((\d+)\)/.test(line)) {
      const m = line.match(/Tests\s+(\d+) passed \((\d+)\)/)!
      testsResult = parseInt(m[1]) === parseInt(m[2])
    }
    if (/\bfailed\b/.test(line) && /\bTests?\b/.test(line)) testsResult = false
    if (/✗|not ok\s+\d+/.test(line)) {
      testsResult = false
      if (testsErrors.length < 10) testsErrors.push(line)
    }

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
    trace.verification = { tsc_passed: tscResult, tests_passed: testsResult, grep_checks: grepChecks, tsc_errors: tscErrors, tests_errors: testsErrors }
  }

  // Merge git show --stat entries into files_changed (don't replace)
  if (trace.git_commit && projectPath) {
    try {
      const out = execSync(`git show --stat --format="" ${trace.git_commit}`, { cwd: projectPath, timeout: 5000 }).toString()
      const fileMatches = out.match(/^[ \t]+(.+)/gm)
      if (fileMatches) {
        const gitFiles = fileMatches.map(f => f.trim().split('|')[0].trim()).filter(f => f && !f.includes('=>') && !/\d+ files? changed/.test(f))
        for (const gf of gitFiles) {
          if (!trace.files_changed.includes(gf)) trace.files_changed.push(gf)
        }
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
  let orphanOcEvents: OrchEvent[] = []
  let i = 0
  let cycleIdx = 1
  while (i < groups.length) {
    const ccGroup = groups[i]?.tool === 'cc' ? groups[i] : null
    const ocGroup = groups[i + 1]?.tool === 'oc' ? groups[i + 1] : null

    // Orphan OC group (no preceding CC paired with it)
    if (groups[i].tool === 'oc') {
      orphanOcEvents = groups[i].events
      i += 1
      continue
    }

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

      // Include orphan OC events in this cycle's trace range
      const allOcEvents = [...orphanOcEvents, ...ocGroup.events]
      orphanOcEvents = []

      const ccStart = ccGroup.events[0].full_ts
      const ccEnd = ccGroup.events[ccGroup.events.length - 1].full_ts
      const ccTrace = extractTraceForRange(ccStart, ccEnd, 'cc', projectPath)
      const ocStart = allOcEvents[0].full_ts
      const ocEnd = allOcEvents[allOcEvents.length - 1].full_ts
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
        cc_cost: null, oc_cost: null,
        cc_input_tokens: null, cc_output_tokens: null, cc_cache_tokens: null,
        oc_input_tokens: null, oc_output_tokens: null, oc_cache_tokens: null,
        cc_model: null, oc_model: null,
        cc_tool_counts: null, oc_tool_counts: null,
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
        cc_cost: null, oc_cost: null,
        cc_input_tokens: null, cc_output_tokens: null, cc_cache_tokens: null,
        oc_input_tokens: null, oc_output_tokens: null, oc_cache_tokens: null,
        cc_model: null, oc_model: null,
        cc_tool_counts: null, oc_tool_counts: null,
      })
      i += 1
    } else {
      i += 1
    }
  }

  return cycles
}

function readSpecFiles(projectPath: string): Record<string, string> {
  const files: Record<string, string> = {}
  const names = ['SPEC.md', 'OC-TASK.md', 'OC-REPORT.md']
  for (const name of names) {
    const fp = path.join(projectPath, 'specs', name)
    try { files[name] = fs.readFileSync(fp, 'utf-8') } catch { /* file not found */ }
  }
  return files
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
      res.json({ status: 'none', project_path: null, project_name: null, goal: '', current_phase: null, total_phases: 0, completed: 0, phase_retry: 0, waiting_for_user: false, tsc_passed: null, tests_passed: null, tsc_errors: [], tests_errors: [], started_at: null, cc_events: [], oc_events: [], cycles: [], cc_total_cost: 0, oc_total_cost: 0, spec_files: {}, command_log: [], file_changes: [] })
      return
    }

    if (_cache.data && _cache.projectPath === active.projectPath && Date.now() - _cache.ts < CACHE_TTL_MS) {
      res.json(_cache.data)
      return
    }

    const wf = active.wf
    const specPhases = parseSpecPhases(active.projectPath)
    const totalPhases = specPhases.length
    const completed = wf?.total_cycles ?? 0
    const wfStartTs = wf.created_at ? new Date(wf.created_at).getTime() : undefined
    const { cc, oc, detectedStartTs, command_log, file_changes } = parseLog(wfStartTs)
    const cycles = buildCycles(cc, oc, active.projectPath, specPhases)

    // Prefer the log-detected start (CICLO 1 timestamp) over wf.created_at — more reliable.
    const runStartMs = detectedStartTs ?? toTimestampMs(wf.created_at)

    // Enrich cycles with DB session cost/token data
    if (runStartMs > 0) {
      const sessions = dbOps.getSessionsInRange(runStartMs, Date.now() + 60_000)
      const ccSess = sessions.filter(s => !s.id.startsWith('ses_') && !s.id.startsWith('agent-')).sort((a, b) => a.started_at - b.started_at)
      const ocSess = sessions.filter(s => s.id.startsWith('ses_')).sort((a, b) => a.started_at - b.started_at)
      let ci = 0, oi = 0
      for (const cycle of cycles) {
        if (cycle.cc_events.length > 0 && ci < ccSess.length) {
          const s = ccSess[ci++]
          cycle.cc_cost = s.total_cost_usd ?? null
          cycle.cc_input_tokens = s.total_input_tokens ?? null
          cycle.cc_output_tokens = s.total_output_tokens ?? null
          cycle.cc_cache_tokens = s.total_cache_read ?? null
          cycle.cc_model = s.dominant_model ?? null
          cycle.cc_tool_counts = dbOps.getToolCountsForSession(s.id)
        }
        if (cycle.oc_events.length > 0 && oi < ocSess.length) {
          const s = ocSess[oi++]
          cycle.oc_cost = s.total_cost_usd ?? null
          cycle.oc_input_tokens = s.total_input_tokens ?? null
          cycle.oc_output_tokens = s.total_output_tokens ?? null
          cycle.oc_cache_tokens = s.total_cache_read ?? null
          cycle.oc_model = s.dominant_model ?? null
          cycle.oc_tool_counts = dbOps.getToolCountsForSession(s.id)
        }
      }
    }

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
      tsc_errors:     Array.isArray(wf.tsc_errors) ? wf.tsc_errors : [],
      tests_errors:   Array.isArray(wf.tests_errors) ? wf.tests_errors : [],
      started_at:     detectedStartTs ? new Date(detectedStartTs).toISOString() : (wf?.created_at ?? null),
      cc_events:      cc,
      oc_events:      oc,
      cycles,
      cc_total_cost:  cycles.reduce((s, c) => s + (c.cc_cost ?? 0), 0),
      oc_total_cost:  cycles.reduce((s, c) => s + (c.oc_cost ?? 0), 0),
      spec_files:     readSpecFiles(active.projectPath),
      command_log,
      file_changes,
    }

    const cleanToolMarker = (events: OrchEvent[]) => events.forEach(e => delete (e as any)._tool)
    for (const c of detail.cycles) {
      cleanToolMarker(c.cc_events)
      cleanToolMarker(c.oc_events)
    }
    cleanToolMarker(detail.cc_events)
    cleanToolMarker(detail.oc_events)

    _cache = { data: detail, ts: Date.now(), projectPath: active.projectPath }

    try {
      const runKey = `${active.projectPath}::${wf.created_at ?? 'unknown'}`
      dbOps.upsertOrchRun({
        run_key:      runKey,
        project_path: active.projectPath,
        project_name: active.projectName,
        goal:         wf.goal ?? null,
        status:       detail.status,
        total_cycles: detail.completed,
        started_at:   wf.created_at ?? new Date().toISOString(),
        ended_at:     detail.status === 'complete' ? new Date().toISOString() : null,
        metrics_json: null,
        snapshot_json: JSON.stringify(detail),
      })
    } catch {}

    res.json(detail)
  } catch (err) {
    res.json({ status: 'none', project_path: null, project_name: null, goal: '', current_phase: null, total_phases: 0, completed: 0, phase_retry: 0, waiting_for_user: false, tsc_passed: null, tests_passed: null, tsc_errors: [], tests_errors: [], started_at: null, cc_events: [], oc_events: [], cycles: [], cc_total_cost: 0, oc_total_cost: 0, spec_files: {}, command_log: [], file_changes: [] })
  }
})

orchestrationRouter.get('/api/orchestration/runs', (_req: Request, res: Response) => {
  try {
    const active = findActiveOrchestration()
    const projectPath = active?.projectPath ?? ''
    const runs = projectPath ? dbOps.getOrchRuns(projectPath) : []
    res.json(runs)
  } catch {
    res.json([])
  }
})

orchestrationRouter.get('/api/orchestration/runs/:runKey', (req: Request, res: Response) => {
  try {
    const runKey = decodeURIComponent(req.params.runKey)
    const run = dbOps.getOrchRun(runKey)
    if (!run) { res.status(404).json({ error: 'Run not found' }); return }

    if (run.snapshot_json) {
      res.json(JSON.parse(run.snapshot_json))
      return
    }

    // Build partial detail from DB fields when no snapshot exists
    const partialDetail: OrchDetail = {
      project_path:   run.project_path ?? '',
      project_name:   run.project_name ?? '',
      goal:           run.goal ?? '',
      status:         run.status === 'complete' ? 'complete' : run.status === 'active' ? 'active' : 'none',
      current_phase:  null,
      total_phases:   run.total_cycles ?? 0,
      completed:      run.total_cycles ?? 0,
      phase_retry:    0,
      waiting_for_user: false,
      tsc_passed:     null,
      tests_passed:   null,
      tsc_errors:     [],
      tests_errors:   [],
      started_at:     run.started_at ?? null,
      cc_events:      [],
      oc_events:      [],
      cycles:         [],
      cc_total_cost:  0,
      oc_total_cost:  0,
      spec_files:     readSpecFiles(run.project_path ?? ''),
      command_log:    [],
      file_changes:   [],
    }
    res.json(partialDetail)
  } catch {
    res.status(500).json({ error: 'Internal error' })
  }
})

orchestrationRouter.get('/api/orchestration/stats', (_req: Request, res: Response) => {
  try {
    const active = findActiveOrchestration()
    if (!active) { res.json({ avg_cost_per_cycle: 0, avg_duration_secs: 0, avg_error_rate: 0, avg_verify_pass_rate: 0, total_runs: 0 }); return }
    const agg = dbOps.getOrchAggregates(active.projectPath)
    res.json(agg)
  } catch {
    res.json({ avg_cost_per_cycle: 0, avg_duration_secs: 0, avg_error_rate: 0, avg_verify_pass_rate: 0, total_runs: 0 })
  }
})

orchestrationRouter.get('/api/orchestration/sessions', (_req: Request, res: Response) => {
  try {
    const active = findActiveOrchestration()
    if (!active) { res.json([]); return }
    const wf = active.wf
    const runStartMs = wf?.created_at ? new Date(wf.created_at).getTime() : (Date.now() - 86_400_000)
    const sessions = dbOps.getSessionsInRange(runStartMs, Date.now() + 60_000)
    res.json(sessions.map(s => ({
      id: s.id,
      cost: s.total_cost_usd ?? 0,
      input_tokens: s.total_input_tokens ?? 0,
      output_tokens: s.total_output_tokens ?? 0,
      model: s.dominant_model ?? null,
      source: s.id.startsWith('ses_') ? 'opencode' : 'claude-code',
      started_at: s.started_at,
    })))
  } catch {
    res.json([])
  }
})

orchestrationRouter.get('/api/orchestration/diff', (req: Request, res: Response) => {
  try {
    const runAKey = req.query.runA as string
    const runBKey = req.query.runB as string
    if (!runAKey || !runBKey) { res.status(400).json({ error: 'runA and runB required' }); return }
    const runA = dbOps.getOrchRun(runAKey)
    const runB = dbOps.getOrchRun(runBKey)
    if (!runA || !runB) { res.status(404).json({ error: 'Run not found' }); return }
    let snapA: any, snapB: any
    try { snapA = JSON.parse(runA.snapshot_json ?? '{}') } catch { snapA = { cycles: [] } }
    try { snapB = JSON.parse(runB.snapshot_json ?? '{}') } catch { snapB = { cycles: [] } }
    const cyclesA = (snapA.cycles ?? []) as OrchCycle[]
    const cyclesB = (snapB.cycles ?? []) as OrchCycle[]
    const maxLen = Math.max(cyclesA.length, cyclesB.length)
    const diffs = []
    for (let i = 0; i < maxLen; i++) {
      const ca = cyclesA[i]
      const cb = cyclesB[i]
      if (!ca && !cb) continue
      diffs.push({
        index: i + 1,
        label: cb?.label ?? ca?.label ?? `Cycle ${i + 1}`,
        costDiff: (cb?.cc_cost ?? 0) + (cb?.oc_cost ?? 0) - ((ca?.cc_cost ?? 0) + (ca?.oc_cost ?? 0)),
        durDiff: (cb?.duration_secs ?? 0) - (ca?.duration_secs ?? 0),
        toolsDiff: (cb ? Object.values(cb.cc_tool_counts ?? {}).reduce((s: number, c: number) => s + c, 0) + Object.values(cb.oc_tool_counts ?? {}).reduce((s: number, c: number) => s + c, 0) : 0)
          - (ca ? Object.values(ca.cc_tool_counts ?? {}).reduce((s: number, c: number) => s + c, 0) + Object.values(ca.oc_tool_counts ?? {}).reduce((s: number, c: number) => s + c, 0) : 0),
        statusA: ca?.status ?? null,
        statusB: cb?.status ?? null,
      })
    }
    res.json({
      runA: { run_key: runAKey, project: runA.project_name, cycles: cyclesA.length },
      runB: { run_key: runBKey, project: runB.project_name, cycles: cyclesB.length },
      diffs,
    })
  } catch {
    res.status(500).json({ error: 'Internal error' })
  }
})

orchestrationRouter.post('/api/orchestration/control', (req: Request, res: Response) => {
  try {
    const action = req.body?.action as string | undefined
    const active = findActiveOrchestration()
    if (!active) { res.status(404).json({ error: 'No active orchestration' }); return }

    if (action === 'resolve_doubts') {
      const doubtsPath = path.join(active.projectPath, 'specs', 'DOUBTS.md')
      const response = req.body?.response as string | undefined
      if (response) {
        fs.writeFileSync(doubtsPath, response, 'utf-8')
      }
      res.json({ ok: true, action })
    } else if (action === 'emergency_stop') {
      const taskPath = path.join(active.projectPath, 'specs', 'OC-TASK.md')
      fs.writeFileSync(taskPath, '# EMERGENCY STOP — Orchestration halted by user', 'utf-8')
      res.json({ ok: true, action })
    } else {
      res.status(400).json({ error: 'Unknown action. Valid: resolve_doubts, emergency_stop' })
    }
  } catch {
    res.status(500).json({ error: 'Internal error' })
  }
})
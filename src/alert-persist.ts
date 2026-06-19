import fs   from 'fs'
import path from 'path'
import { getClaudestatDir } from './paths'

export interface AlertState {
  cycleAlertLevel:        string | null
  weeklyAlertLevel:       string | null
  weeklyThresholdsFired:  number[]
  resetReminderFired:     boolean
  lastCycleResetAt:       number
  lastWeeklyPctSeen:      number
  quotaAlertCooldown:     Record<string, number>
  contextThresholdsFired: Record<string, number[]>
}

const STATE_FILE = path.join(getClaudestatDir(), 'alert-state.json')

const DEFAULTS: AlertState = {
  cycleAlertLevel:        null,
  weeklyAlertLevel:       null,
  weeklyThresholdsFired:  [],
  resetReminderFired:     false,
  lastCycleResetAt:       0,
  lastWeeklyPctSeen:      0,
  quotaAlertCooldown:     {},
  contextThresholdsFired: {},
}

let _state: AlertState | null = null

export function getAlertState(): AlertState {
  if (!_state) {
    try {
      _state = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }
    } catch {
      _state = { ...DEFAULTS }
    }
  }
  return _state!
}

export function persistAlertState(): void {
  if (!_state) return
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(_state))
  } catch { /* non-critical */ }
}

export interface TraceEvent {
  type:         string
  tool_name?:   string
  tool_input?:  string
  ts:           number
  duration_ms?: number
  session_id?:  string
  cwd?:         string
}

export interface LoopAlert {
  toolName: string
  count:    number
  ts:       number
}

export interface CostInfo {
  cost_usd:         number
  input_tokens:     number
  output_tokens:    number
  cache_read:       number
  cache_creation:   number
  efficiency_score: number
  loops:            LoopAlert[]
  summary?:         string
  context_used?:    number
  context_window?:  number
}

export interface DayStats {
  date:   string
  tokens: number
}

export interface AppState {
  sessionId:    string
  cwd:          string
  startedAt:    number
  events:       TraceEvent[]
  cost?:        CostInfo
  weeklyData:   DayStats[]
  sessionState: SessionState
}

// ─── Historial y proyectos ────────────────────────────────────────────────────

export type SessionMode = 'directo' | 'agentes' | 'skills' | 'agentes+skills'

export interface SessionSummary {
  id:             string
  project_path:   string | null
  project_name:   string | null
  started_at:     number
  last_event_at:  number
  duration_ms:    number
  total_cost_usd: number
  total_tokens:   number
  efficiency_score: number
  loops_detected: number
  done_count:     number
  top_tools:      string[]
  mode:           SessionMode
  // Phase 5
  ai_summary?:  string | null
  git_branch?:  string | null
  git_dirty?:   boolean
  git_ahead?:   number
  git_behind?:  number
}

export interface GitInfo {
  branch:    string
  dirty:     boolean
  ahead:     number
  behind:    number
  hasRemote: boolean
}

export interface PRStatus {
  number:  number
  title:   string
  state:   'OPEN' | 'CLOSED' | 'MERGED'
  url:     string
  branch:  string
  ciState: 'SUCCESS' | 'FAILURE' | 'PENDING' | null
}

export interface DaySessions {
  date:              string
  sessions:          SessionSummary[]
  total_cost:        number
  total_tokens:      number
  total_duration_ms: number
}

export interface HandoffProgress {
  done:     number
  total:    number
  pct:      number
  nextTask: string | null
}

export interface ProjectSummary {
  path:           string
  name:           string
  session_count:  number
  total_cost_usd: number
  total_tokens:   number
  last_active:    number | null
  avg_efficiency: number | null
  has_handoff:    boolean
  progress:       HandoffProgress
}

// ─── Meta-stats (KPIs de contexto) ────────────────────────────────────────────

export interface MetaAlert {
  level:   'info' | 'warning' | 'critical'
  message: string
  metric:  string
}

export interface MetaStats {
  ts:               number
  handoffTokens:    number
  engramTokens:     number
  engramFileCount:  number
  configTokens:     number
  alerts:           MetaAlert[]
}

export interface MetaSnapshot {
  ts:            number
  handoffTokens: number
  engramTokens:  number
  configTokens:  number
}

// ─── Session state machine ────────────────────────────────────────────────────

export type SessionState = 'working' | 'waiting_for_input' | 'idle'

// ─── Quota ────────────────────────────────────────────────────────────────────

export type ClaudePlan = 'free' | 'pro' | 'max5' | 'max20'

export interface QuotaData {
  cyclePrompts:    number
  cycleLimit:      number
  cyclePct:        number
  cycleResetMs:    number
  cycleStartTs:    number
  weeklyHoursSonnet: number
  weeklyHoursOpus:   number
  weeklyLimitSonnet: number
  weeklyLimitOpus:   number
  burnRateTokensPerMin: number
  detectedPlan:    ClaudePlan
  computedAt:      number
}

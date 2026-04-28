export interface TraceEvent {
  type:          string
  tool_name?:    string
  tool_input?:   string
  tool_output?:  string
  ts:            number
  duration_ms?:  number
  session_id?:   string
  cwd?:          string
  skill_parent?: string
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
  model?:           string
  projected_hourly_usd?: number
}

export interface DayStats {
  date:   string
  tokens: number
}

export interface BlockCost {
  inputUsd:     number   // costo del prompt + contexto enviado
  outputUsd:    number   // costo de la respuesta generada por Claude
  totalUsd:     number
  inputTokens:  number   // tokens de entrada de este bloque
  outputTokens: number   // tokens de salida de este bloque
}

export interface SubAgentSession {
  id:               string
  dominant_model?:  string
  total_cost_usd?:  number
  started_at:       number
}

export interface AppState {
  sessionId:        string
  cwd:              string
  startedAt:        number
  events:           TraceEvent[]
  cost?:            CostInfo
  weeklyData:       DayStats[]
  sessionState:     SessionState
  blockCosts:       BlockCost[]       // un entry por bloque completo (agrupado por Stop)
  pendingBlockCost: BlockCost | null  // acumula sub-turnos del bloque en curso
  subAgentSessions: SubAgentSession[] // sub-sesiones lanzadas por Agent en esta sesión
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

export interface ModelUsage {
  opusTokens:   number
  sonnetTokens: number
  haikuTokens:  number
}

export type InsightLevel = 'tip' | 'warning' | 'positive'

export interface PatternInsight {
  level:       InsightLevel
  title:       string
  description: string
  metric?:     string
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
  auto_handoff?:  boolean
  progress:       HandoffProgress
  model_usage?:   ModelUsage
  insights?:      PatternInsight[]
}

// ─── Meta-stats (KPIs de contexto) ────────────────────────────────────────────

export interface MetaAlert {
  level:   'info' | 'warning' | 'critical'
  message: string
  metric:  string
}

export interface ContextFileInfo {
  label:  string
  tokens: number
}

export interface MetaStats {
  ts:                    number
  contextFiles:          ContextFileInfo[]
  contextOverheadTokens: number
  alerts:                MetaAlert[]
}

export interface MetaSnapshot {
  ts:                    number
  contextOverheadTokens: number
}

// ─── Session state machine ────────────────────────────────────────────────────

export type SessionState = 'working' | 'waiting_for_input' | 'idle'

// ─── Claude Stats (stats-cache.json) ─────────────────────────────────────────

export interface DayActivity {
  date:         string
  messages:     number
  sessions:     number
  tools:        number
  outputTokens: number
}

export interface ClaudeStatsData {
  today:        DayActivity | null
  yesterday:    DayActivity | null
  last7:        DayActivity
  allTime:      { sessions: number; messages: number }
  cacheDate:    string | null
  todayLabel:   string | null
  cacheIsStale: boolean
}

// ─── Quota ────────────────────────────────────────────────────────────────────

export type ClaudePlan = 'free' | 'pro' | 'max5' | 'max20'

export interface QuotaData {
  cyclePrompts:    number
  cycleLimit:      number
  cyclePct:        number
  cycleResetMs:    number
  cycleResetAt:    number   // timestamp absoluto del próximo reset
  cycleStartTs:    number
  weeklyHoursSonnet:  number
  weeklyHoursOpus:    number
  weeklyHoursHaiku:   number
  weeklyTokensSonnet: number
  weeklyTokensOpus:   number
  weeklyTokensHaiku:  number
  weeklyLimitSonnet:  number
  weeklyLimitOpus:   number
  burnRateTokensPerMin: number
  detectedPlan:    ClaudePlan
  planSource:      'config' | 'keychain' | 'inferred'
  computedAt:      number
}

export interface QuotaStats {
  p90Tokens:    number
  p90Cost:      number
  sessionCount: number
}

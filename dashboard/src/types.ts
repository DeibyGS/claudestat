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
  text_preview?: string
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
  source?:          string
  started_at?:      number
  projected_hourly_usd?: number
}

export interface DayStats {
  date:   string
  tokens: number
}

export interface BlockCost {
  inputUsd:      number   // costo del prompt + contexto enviado
  outputUsd:     number   // costo de la respuesta generada por Claude
  totalUsd:      number
  inputTokens:   number   // tokens de entrada de este bloque
  outputTokens:  number   // tokens de salida de este bloque
  cacheRead?:      number  // tokens de cache leídos
  cache_creation?: number  // tokens de cache creados
  context_used?:   number  // tokens de contexto activo al final del bloque
  context_window?: number  // tamaño máximo del modelo
  sessionId?:      string  // sesión a la que pertenece este bloque
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

export interface ActiveSource {
  source:        string
  sessionId:     string
  model:         string
  cost_usd:      number
  last_seen_ms:  number
  input_tokens:  number
  output_tokens: number
  cache_read:    number
  cache_creation: number
  project?:      string | null
}

// ─── Historial y proyectos ────────────────────────────────────────────────────

export type SessionMode = 'directo' | 'agentes' | 'skills' | 'agentes+skills' | 'sub-agente'

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
  source?:       string
  is_sub_agent?: boolean
  merged_count?: number
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

export interface SourceStats {
  session_count:  number
  total_cost_usd: number
  total_tokens:   number
  avg_efficiency: number | null
  avg_loops:      number
  last_active:    number | null
  dominant_model: string | null
}

export interface ProjectRecentExtremes {
  heavy_loop_sessions: number
  recent_sessions:     number
  max_session_cost:    number
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
  cli_hours?:     Record<string, number>
  source_stats?:  Record<string, SourceStats>
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

export interface AssistantTurnData {
  turn_index:    number
  ts?:           number
  text_preview?: string
  tool_calls:    string[]
  error_count:   number
  output_chars:  number
  context_used:  number
  model?:        string
  effort?:       string
  stop_reason?:  string
  stop_sequence?: string
}

export interface AgentNode {
  id:             string
  dominant_model?: string
  total_cost_usd?: number
  started_at:     number
  children:       AgentNode[]
}

export interface ToolStatusEntry {
  status:      'working' | 'idle' | 'unknown'
  last_task:   string | null
  finished_at: number | null
  session_id?: string | null
  waiting_for?: string | null
}

export type ToolStatus = Record<string, ToolStatusEntry>

export interface DailyActivity {
  date:         string
  cost_usd:     number
  total_tokens: number
  tool_calls:   number
}

// ─── Orchestration timeline types ───────────────────────────────────────────

export interface OrchEvent {
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

export interface OrchCycleTrace {
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

export interface OrchCycle {
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
  cc_tool_counts:      Record<string, number> | null
  oc_tool_counts:      Record<string, number> | null
  cc_session_id:       string | null
  oc_session_id:       string | null
  oc_tokens_estimated: boolean
}

export interface CommandLogEntry {
  ts:      number
  command: string
}

export interface FileChangeEntry {
  ts:     number
  path:   string
  action: 'create' | 'modify' | 'delete'
}

export interface OrchTimeline {
  status:           'active' | 'paused' | 'complete' | 'none'
  project_path:     string | null
  project_name:     string | null
  goal:             string
  current_phase:    string | null
  total_phases:     number
  completed:        number
  phase_retry:      number
  waiting_for_user: boolean
  tsc_passed:       boolean | null
  tests_passed:     boolean | null
  tsc_errors:       string[]
  tests_errors:     string[]
  started_at:       string | null
  cc_events:        OrchEvent[]
  oc_events:        OrchEvent[]
  cycles:           OrchCycle[]
  cc_total_cost:    number
  oc_total_cost:    number
  spec_files:       Record<string, string>
  command_log:      CommandLogEntry[]
  file_changes:     FileChangeEntry[]
}

export interface OrchRunSummary {
  id:           number
  run_key:      string
  project_name: string | null
  goal:         string | null
  status:       string
  total_cycles: number
  started_at:   string
  ended_at:     string | null
}

export interface OrchFrameworkHealth {
  scripts:        { name: string; size: number; executable: boolean }[]
  prompts:        { name: string; lines: number }[]
  skill_lines:    number | null
  status_json_valid: boolean
}

export interface OrchAggregates {
  avg_cost_per_cycle:   number
  avg_duration_secs:    number
  avg_error_rate:       number
  avg_verify_pass_rate: number
  total_runs:           number
}

export interface GanttBar {
  cycleIdx:    number
  label:       string
  status:      OrchCycle['status']
  verified:    boolean | null
  leftPct:     number
  widthPct:    number
  cost:        number | null
  duration:    number | null
  tool:        'cc' | 'oc'
}

export interface SessionTableRow {
  id:          string
  cost:        number
  input_tokens: number
  output_tokens: number
  model:       string | null
  source:      'claude-code' | 'opencode'
  started_at:  number
}

export interface CycleToolTrend {
  cycleIdx:     number
  label:        string
  Read:         number
  Edit:         number
  Bash:         number
  Other:        number
}

export interface CycleDiff {
  index:     number
  label:     string
  costDiff:  number
  durDiff:   number
  toolsDiff: number
  statusA:   string | null
  statusB:   string | null
}

export interface DiffResult {
  runA:  { run_key: string; project: string | null; cycles: number }
  runB:  { run_key: string; project: string | null; cycles: number }
  diffs: CycleDiff[]
}

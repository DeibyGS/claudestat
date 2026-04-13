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
  sessionId:  string
  cwd:        string
  startedAt:  number
  events:     TraceEvent[]
  cost?:      CostInfo
  weeklyData: DayStats[]
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

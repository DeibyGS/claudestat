# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.21.2] - 2026-08-25

### Fixed

- **`claude-sonnet-5` context window** — corrected to 967K tokens (the real auto-compact window reported by Claude Code's `/context`), was hardcoded to 1M
- **Live-tab context KPI showed the other tool's data** — Claude Code's context KPI read from a single global "latest session" SSE state shared across sources, so it displayed OpenCode's numbers whenever OpenCode was the most recently active session; Claude Code now tracks its own context state, filtered by the currently selected session so a sub-agent session can't overwrite the parent's KPI either
- **Cost/block history missing on connect** — `/stream` init loaded block-cost history only for whichever session was globally "latest" across sources; Claude Code and OpenCode now each resolve their own latest session independently
- **OpenCode Cost/block KPI always showed "—"** — OpenCode has no `Stop` hook event, so cost fragments accumulated in a pending buffer that never flushed; each OpenCode block now closes immediately (a `step-finish` is already a complete turn), with a dedup guard so an in-progress turn's poll ticks don't push duplicate blocks, and historical blocks now backfill on connect
- **Dashboard crashed to a black screen when switching between Claude Code/OpenCode Live tabs** — `ContextCurve` declared a `useCallback` after a conditional early return, violating the Rules of Hooks; alternating tabs changed the hook count between renders and crashed React (#81)

## [1.21.1] - 2026-08-23

### Fixed

- **Live-tab execution blocks fragmented per tool call** — `syntheticStopsFor()` emitted a synthetic `Stop` between every `AssistantTurn`, but Claude Code writes one JSONL `assistant` line per tool call, not per full response, so long sessions showed hundreds of one-tool blocks instead of grouping by user turn. Synthetic stops are now restricted to turns that actually close a real user prompt (#79)
- **KPI cost/context mini-charts regression (v1.20.0)** — the `blockCosts` sub-turn merge for the Cost/block and Context KPI cards was pushing each sub-turn directly instead of accumulating until `Stop`, breaking the charts introduced in 1.20.0; restored the merge-until-`Stop` logic and scoped blocks to the active live session (#79)
- **`claude-sonnet-5` context window** — added to `KNOWN_CONTEXT_WINDOWS` (1M tokens); `context_used` no longer double-counts `output_tokens`

## [1.20.0] - 2026-08-23

### Added

- **KPI mini-charts** — interactive Cost/block bar chart and Context usage area chart (with 85% compaction threshold line) on the Live tab KPI cards
- **OpenCode session-based context tracking** via `step-finish` events

### Changed

- **Header layout** — compact navbar alignment and uniform badge heights
- **Heavy context notification** — now shows actual token values instead of a generic warning

### Fixed

- **CC `context_used` formula** — corrected to match official documentation

## [1.19.0] - 2026-08-23

### Fixed

- **Context window notifications accuracy** — `context_used` now includes output tokens in Claude Code watcher, matching the real context usage reported by the API
- **Weekly quota alerts using real data** — daemon now calls `refreshFromApi()` at startup and every 5 minutes, so weekly quota alerts use actual Anthropic API percentages instead of JSONL-based estimation
- **Silent API failures** — quota tracker now logs errors when the Anthropic OAuth API is unreachable instead of falling back silently to JSONL estimation

### Added

- **`claudestat doctor` API check** — new check #12 verifies Anthropic OAuth API accessibility and reports whether weekly quota will use real or estimated data
- **Notification system tests** — 32 new tests covering context threshold triggers, weekly/cycle alerts, cooldown logic, and anti-duplicate mechanisms

## [1.18.0] - 2026-08-18

### Added

- **Assistant-turn metadata tooltips** — hover on the Model, Effort, Stop reason and Stop sequence chips in the session replay shows an explanatory tooltip; "Context Decay" heading now has its own tooltip too
- **Turn metadata** — `model`, `effort`, `stop_reason` and `stop_sequence` are now persisted per assistant turn (migration v26) and surfaced in the dashboard types

### Fixed

- **OpenCode `context_used` underreporting** — output tokens were not counted; the metric now sums input + cache_read + cache_write + output, matching the Claude Code side (#74)
- **Claude Code live-tab blocks** — a session showed one giant block instead of one per turn because block slicing only cuts on `Stop` events, which Claude Code emits roughly once per response. Synthetic per-turn Stops (deduplicated against real ones) are now served over SSE and the polling API, so blocks match OpenCode granularity (#73)
- **Live-tab list reset with parallel sessions** — an SSE event arriving from an *other* session (OC vs CC) cleared the visible event list; those events are now ignored (#73)
- **SSE init event cap** — bumped from 200 to 2000 so long sessions render fully on first connect (#73)
- **Tooltips clipped by scroll container** — `Tip` renders through a portal to `document.body` with fixed positioning and viewport clamping, so tooltips are no longer cut off inside the scrollable panel (#73)

## [1.17.0] - 2026-08-11

### Added

- **Configurable context windows** — `contextWindowOverrides` in config adds or overrides model context windows without editing source (Bug #10)
- **`install --dry-run`** — preview installation changes without applying them
- **`install --json`** — machine-readable output for scripting
- **Source maps** — `sourceMap: true` in `tsconfig.json` for readable stack traces

### Changed

- **OpenCode model detection** — model is read directly from `opencode.db` via `getOpencodeDb()`, honoring the `OPENCODE_DB` env var; fewer sessions reported as `unknown`
- **Orchestration log rotation** — log trims at 50,000 lines with a 5s cache TTL, preventing unbounded growth (~3.4 MB/day)
- **Pricing consolidation** — three duplicate pricing tables merged into `pricing.ts`, three `CONTEXT_THRESHOLDS` duplicates deduplicated, `DEFAULT_MODEL` exported as a shared constant
- **README** — rebalanced comparison table (claudestat vs ccusage vs OpenUsage), added missing CLI commands (`resume`, `loops`, `logs`, `update`), documented the full 50+ function `dbOps` surface

### Fixed

- **`watch` command port** — the configured daemon port was ignored
- **`replay` context window** — used a hardcoded value instead of the model's real context window
- **CI workflow** — actions updated to v5 (checkout, setup-node, upload-artifact) plus `nick-fields/retry@v3` for transient publish-check failures

## [1.16.1] - 2026-08-05

### Fixed

- **Session-closed desktop notification** — new `src/session-tracker.ts` detects session close by replacement (a new session from the same source means the previous one ended), firing the notification exactly once per session; pending notifications are flushed on daemon shutdown

### Added

- **AI Development Benchmark** — README section documenting the process-focused benchmark

## [1.16.0] - 2026-08-05

### Changed

- **MCP server migrated to the official SDK** — the custom JSON-RPC engine was replaced by `@modelcontextprotocol/sdk@1.30.0`

## [1.15.0] - 2026-07-26

### Added

- **Windows compatibility (~99% of features)** — cross-platform paths and signals, health check over Node `http` (no `curl` dependency), auto-start via `schtasks`, clipboard via `clip`

### Changed

- **README overhaul** — 9 MCP tools, Windows service, MCP bundle, 7 dashboard tabs

## [1.14.0] - 2026-07-26

### Added

- **`createMcpServer()` factory** — extracted from `mcp-server.ts` into `src/mcp-factory.ts`; `mcp-server.ts` is now a thin CLI wrapper and the factory is exported from `src/lib.ts`

## [1.13.0] - 2026-07-07

### Added

- **Public library API** — `src/lib.ts` barrel exposing the read-only `dbOps` surface plus pure helpers (`findPricing`, `analyzeSession`, …)
- **Lazy daemon guard** — `src/lib-guard.ts` checks daemon health on first `dbOps` property access via a Proxy; configurable with `configure({ throwOnNoDaemon })` or `CLAUDESTAT_LIB_THROW_ON_NO_DAEMON`

> **Note:** the library surface is `@experimental` until v2.0 — exports may break in minor and patch releases. Pin an exact version.

## [1.12.2] - 2026-06-23

### Added

- **Cycle trace persistence** — completed orchestration cycle traces (files changed, git commit) are now stored in `orch_cycle_traces` DB table (migration 25), surviving log rotation across multi-day runs

### Fixed

- **CC token count includes cache** — `cc_input_tokens` now sums `total_input + cache_read + cache_creation` tokens for accurate display matching the actual session cost
- **OC-REPORT.md file fallback** — OC-only cycles with no git-tracked files now extract `files_changed` from `specs/OC-REPORT.md` bullet lists as a fallback
- **OC model fallback** — cycles with unknown OC model (`deepseek-v4-flash-free` free tier) fall back to `deepseek-chat` pricing for cost estimation; free-tier cost is always read from `opencode.db`

## [1.12.0] - 2026-06-20

### Added

- **Persistent alert state** — cycle, weekly, and context thresholds now survive daemon restarts via `~/.claudestat/alert-state.json`; no more notification spam on restart
- **Actionable MCP push notifications** — context/cycle/weekly messages now include hints like `/compact`, `/checkpoint`, and estimated days remaining

### Fixed

- **CC disappearing from Live navbar** — `supersededIds` logic now scoped to `source !== 'claude-code'`; CC main session no longer suppressed by its own Agent sub-sessions
- **MCP context re-fire on sub-agent switch** — thresholds only reset when context drops below 40%, preventing duplicate alerts when CC spawns sub-agents

## [1.11.1] - 2026-06-19

### Fixed

- **Live view flash** — TracePanel no longer shows "Waiting for activity" during the 10s active-sessions poll gap; falls back to SSE events when no session is selected
- **SQLite WAL mode** — enabled `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` to prevent `database is locked` errors and CPU spin (98% CPU) when daemon and MCP server write concurrently
- **Watchdog test hang** — `tests/index.ts` hung indefinitely because `startWatchdog()` spawned real child processes in tests; test now verifies the export without calling it
- **i18n WeeklyReportsView** — translated remaining Spanish strings to English (labels, tooltips, chart legend, status messages)
- **Dashboard build memory** — added `rollupOptions.maxParallelFileOps: 2` to prevent vite being killed by macOS memory pressure (SIGTERM) during `npm publish`

## [1.11.0] - 2026-06-18

### Added

- **Watchdog recovery** — separate process with exponential backoff (1s→30s max) for auto-restart of the daemon
- **`--verbose` flag** — global verbose logging for daemon, enricher, events, and reports
- **CI dashboard freshness check** — verifies `dashboard/dist/` is not stale relative to `dashboard/src/`
- **Test split** — `npm run test:fast` (~9s) runs unit (110) and integration (175) tests in parallel
- **GitHub badges** — Issues and Discussions in README
- **Discussions redirect** — CONTRIBUTING.md points questions to GitHub Discussions
- **`build:only` script** — fast dashboard build without typecheck (dashboard/package.json)

### Changed

- **Logger migration** — daemon, enricher, events, and reports migrated to unified logger.ts
- **`docs/COMMANDS.md`** — full rewrite with flags table, examples, and options
- **`docs/CONFIG.md`** — full rewrite with all documented environment variables
- **Watchdog** — refactored to independent process (no longer an internal thread)
- **README** — Discussions link in header

### Fixed

- **Watchdog restart loop** — exponential backoff prevents infinite restarts on persistent crashes
- **Log timestamps** — `--verbose` shows full_ts with correct time offset

## [1.10.0] - 2026-06-05

### Added

- **Orchestration Command Center v2** — swim-lane canvas with CC/OC rows, cycle detail panel, run history, and emergency stop / resolve doubts controls
- **Orchestrator run history** — `orchestration_runs` DB table (migration 24), snapshot endpoints, and run selector dropdown for viewing past orchestrations
- **Cycle cost & model data** — each cycle in the swim lane shows CC/OC cost, model name, input/output/cache tokens, and skill badges
- **Error detail in verification** — tsc/test failures show first error line inline with tooltip for full output
- **"Orchestration complete" message** — OC event panel shows contextual message when CC marks a phase done without OC needed
- **MCP 5h cycle alerts in CC terminal** — thresholds at 50/75/90/100% now appear as `notifications/message` via the MCP server so Claude Code shows them directly in its output
- **OrchErrorBoundary** — React error boundary wraps OrchestrateView to prevent full dashboard crash on unexpected data
- **Derived tool status** — LiveSourceBar shows working/active/idle with relative time instead of raw last_task
- **Stale source filtering** — sources inactive for >5 min are excluded from the live session bar
- **`getSessionsInRange`** — new DB method for querying sessions by timestamp range (used by orchestration cost enrichment)

### Changed

- **Context threshold tracking** — changed from `Set<number>` to `Map<sessionId, Set<number>>` so thresholds reset correctly per-session instead of globally
- **OrchestrateView null safety** — all `displayData` property accesses use optional chaining to prevent crash when selecting a historical run without snapshot data
- **VerificationRow** — now accepts optional `errors` prop and shows first error line on failure
- **SwimLaneCell** — shows cost, model, top 2 file names, and skill badges per cycle
- **DetailPanel** — shows model name, cost, and TokenRow (in/out/cache) for both CC and OC sections

### Fixed

- **OrchestrateView crash on historical run** — `Cannot read properties of null (reading 'cc_total_cost')` when selecting a run without snapshot data; now shows graceful fallback message
- **Active sessions filtering** — OC sub-agent sessions no longer pollute the live source bar; parent sessions are deduplicated correctly
- **`none` status response** — orchestration/timeline endpoint now includes `cc_total_cost`, `oc_total_cost`, `tsc_errors`, and `tests_errors` in the idle state to match the TypeScript interface
- **Skill name extraction** — captures `→ Skill "name"` pattern from log lines as primary skill source, Engram saves as fallback
- **Test result parsing** — recognizes `✗` and `not ok` patterns in addition to vitest summary lines

## [1.9.2] - 2026-06-04

### Added

- **Session-close desktop notification** — P1: sends a notification when Claude Code session ends (Stop event)
- **Weekly plan threshold alerts** — P2: proactive notifications at 25/50/75/90/100% of weekly usage with days-left estimate and daily burn rate
- **MCP `get_daily_summary` tool** — personalized daily comparison (cost, tokens, sessions) vs. 7-day average with model breakdown and insights
- **MCP context push notifications** — 50/75/90% context usage alerts sent as JSON-RPC `notifications/message` to the MCP client (shown in CC terminal)

### Changed

- **Simplified notification logic** — removed noisy real-time loop in favor of session-close summary notification
- **Event handler refactor** — `onCostUpdate` and `onStopCallback` use shared `broadcast` function instead of inline SSE pushes

## [1.9.1] - 2026-06-03

### Added

- **M1 sparklines** — 7-day mini charts for cost, prompts, and efficiency in session tooltip and System tab
- **M5 DB stats** — SQLite size and session count visible in System tab
- **M6 pulse animation** — active session cards get a pulsing dot indicator
- **Top tab: DB stats** — total sessions and database size in the tools ranking view
- **`/api/db-stats` endpoint** — exposes SQLite stats for dashboard consumption

## [1.9.0] - 2026-06-02

### Added

- **`claudestat blocks`** — show 5-hour billing block history with tokens, sessions, and cost per window; current block highlighted with ▶
- **`claudestat share [session-id]`** — export any session summary as formatted ASCII or JSON; `--copy` copies output to clipboard
- **Analytics tab: 52-week activity heatmap** — visualize coding activity across the full year at a glance
- **Analytics tab: period-over-period deltas** — KPI cards (cost, tokens, efficiency) show ↑↓% vs. the previous period
- **Analytics tab: stacked token chart** — tokens-per-day bar chart now stacks input / output / cache reads in distinct colors
- **Projects tab: search + filter** — search by project name; filter by Active 7d, Cost > $10, or Efficiency < 70%
- **History tab: day selector** — switch between 7 / 14 / 30 / 90-day windows without leaving the tab
- **History tab: merged-session badge** — sessions merged from N consecutive blocks show a ×N badge with tooltip
- **Top tab: expandable "Other" row** — click the Other entry to reveal all tools beyond the top 10 with individual stats
- **Top tab: `/api/top-other` endpoint** — backend route serving the expanded tool list filtered by sort/days/source
- **System tab: MEMORY.md truncation warning** — shows a ⚠ alert when MEMORY.md exceeds 200 lines (Claude Code truncates beyond that)
- **TracePanel: OpenCode sidebar enrichment** — SidebarKPI and SidebarStats now show burn rate and tool count for OC sessions
- **DAGView improvements** — reworked layout engine and edge rendering for clearer dependency graphs

### Fixed

- **LiveSourceBar: removed dead `ActiveSourceCard` export** — unused component cleaned up

## [1.7.0] - 2026-05-30

### Added

- **Shared formatting library** (`shared.ts`) — centralized `fmtCost`/`fmtTok`/`fmtHours`/`fmtDuration`/`sourceColor`/`sourceLabel` across 6+ components, eliminates duplicate function definitions
- **System tab: real collision detection** — `hasConflict` now checks same `file_path` across tools, not just tool name
- **System tab: large_model display** — shows when configured in opencode.json
- **System tab: ActiveToolsSection toggle** — collapsible like every other section
- **Analytics tab: source filter** — All / Claude Code / OpenCode across KPIs and charts
- **Analytics tab: weekly reports modal** — MarkdownView with CSS-styled checkboxes
- **Analytics tab: single period selector** — unified period for charts and project hours
- **Analytics tab: useMemo for filteredKpis** — avoids recomputation on every render
- **Top tab: loading states** — "Loading…" / "Refreshing…" indicators during fetch
- **Top tab: cost projection in separate useEffect** — no longer re-fetches on filter/sort changes
- **Live tab: source badge in block view** — color-coded dot (CC=blue, OC=green) + label in TracePanel header
- **Live tab: expandable bash commands** — "show all N" toggle for blocks with more than 4 Bash calls
- **History tab: project name in ComparePanel** — headers show `project_name · time` instead of timestamp only

### Fixed

- **OpenCode session grouping** — gap threshold 60 s → 300 s; conversation blocks no longer split on short pauses
- **OpenCode active session detection** — `pollSessions` now sets `lastTs` from `row.time_updated`; `upsertSession` replaces `INSERT OR IGNORE` so `last_event_at` updates correctly
- **Live tab: OC event strategy** — events replace on each poll instead of accumulating (prevents stale PreToolUse entries remaining on screen)
- **Analytics: Spanish labels** — "Informe semanal", "Ya existe", "Generado" → English
- **System: emoji in tooltips** — 🟡🟠🔴 → text "yellow → orange → red"
- **System: plan default** — `cfg.plan ?? 'pro'` → `cfg.plan ?? null` (shows — when unset)
- **System: ActiveToolsSection initial fetch** — `fetchIntents()` called on mount before interval starts
- **History tab: pulse animation scope** — `livePulse` keyframe moved to HistoryView render scope (was only in TimelineView)
- **Projects tab: weekly heatmap labels** — ambiguous M/T/W/T/F/S/S → Sun/Mon/Tue/Wed/Thu/Fri/Sat derived from actual date
- **Top tab: tool deduplication** — `key` uses `tool+source` instead of just `tool` (duplicate React keys when source='all')
- **Top tab: maxDuration pre-computed** — consistent with maxCost/maxCount pattern
- **LiveSourceBar: source dot color** — all dots were green; now CC=blue, OC=green, unknown=gray
- **SidebarStats: Spanish labels** — "Sub-agentes", "sesiones" → English

### Changed

- **fmtCost precision** — 3 decimal places for amounts < $10 (was always 2); affects all tabs via shared.ts
- **fmtTok boundary** — handles k ≥ 1000 → M formatting in shared.ts
- **Projects tooltip** — "read from Claude Code JSONL files" → "recorded from tool activity"
- **All remaining Spanish UI text → English** across Live, History, Analytics, and System tabs

## [1.6.1] - 2026-05-27

### Fixed

- **SSE init for OpenCode-only users** — Live dashboard now loads the correct session on connect when Claude Code has no recent sessions (`getLatestSession` instead of `getLatestClaudeSession`)
- **OpenCode DB file descriptor leak** — `pollSessions` now closes the SQLite connection in a `finally` block, preventing fd accumulation on query failures
- **`processLatestForSession` no-op for poll-based adapters** — Skips `PollableAdapter` instances that have no JSONL paths to iterate
- **OpenCode DB path deduplication** — Centralized in `paths.ts` as `getOpencodeDb()` (was duplicated in `opencode.ts` and `opencode-reader.ts`)
- **Live Source Bar misclassification** — Sessions without a `source` field now appear as `unknown` instead of `claude-code`

## [1.6.0] - 2026-05-26

### Added

- **OpenCode support** — Live dashboard now works with OpenCode sessions: tool calls, prompts, model name, intent detection, and session cost
- **LiveSourceBar** — Source switcher in the Live tab to toggle between Claude Code and OpenCode sessions in real time
- **`/api/opencode/session/:id`** — REST endpoint that reads OpenCode's SQLite DB and maps tool calls to the TraceEvent format
- **`/api/session-events`** — REST endpoint returning full event history for a session (bypasses the SSE 200-event init limit)
- **`getLatestClaudeSession()`** — DB query that filters out OpenCode sessions from the Claude Code SSE stream
- **Dynamic actor label** — Block list and detail panel now show the actual model name (e.g. "Deepseek") instead of hardcoded "Claude" for non-Claude models

### Changed

- **Block grouping for OpenCode** — Consecutive assistant messages are accumulated into a single block (matching Claude Code's turn structure)
- **`extractActors`** — Accepts a `defaultLabel` parameter so agent/skill detection works for any source
- **SSE init limit** — Kept at 200 events; full history loaded via HTTP to avoid large payload issues

## [1.1.0] - 2026-05-11

### Added

- **`claudestat share`** — Session shareable cards (ASCII + JSON)
- **`claudestat roast`** — Sarcastic usage analysis
- **`claudestat status --compact`** — One-line tmux output showing 5h cycle quota percentage

### Fixed

- **Null checks** — Added proper type guards to prevent crashes from malformed events
- **Race conditions** — Added file locks to prevent concurrent JSONL processing corruption
- **Error logging** — Empty catch blocks now log errors with `console.warn`
- **PRICING duplication** — Centralized pricing constants to `src/pricing.ts`
- **Share card alignment** — Fixed ASCII art borders alignment for perfect square

### Changed

- **CLI labels in English** — All labels now in English (internationalization)
- **Token-based quota** — `status --compact` now shows token percentage instead of prompt count
- **Current quota label** — Changed to "Current" with emoji indicator

## [0.3.0] - 2026-05-05

### Added

- **Windows compatibility** — ClaudeStat now runs on Windows alongside macOS and Linux
  - New `src/paths.ts` module centralizes all OS-specific path resolution
  - Claude Code data directory: `%APPDATA%\claude\` on Windows, `~/.claude/` on macOS/Linux
  - ClaudeStat data directory: `%USERPROFILE%\.claudestat\` on Windows, `~/.claudestat/` on Unix
  - Platform-aware commands: `which`/`where`, `lsof`/`netstat`, `hash -r`/`refreshenv`
  - NVM detection for both Unix (`NVM_DIR`) and Windows (`NVM_HOME`)
  - Path encoding handles both `/` and `\` separators for Claude Code project directories
  - `fs.chmodSync` skipped on Windows (no effect on NTFS)
  - `os.tmpdir()` replaces hardcoded `/tmp` in tests
  - Windows credential paths: `%APPDATA%\Claude\` and `%LOCALAPPDATA%\Claude\`
- **16 new cross-platform tests** in `tests/paths.test.ts` (152 total, all passing)
- **Dynamic version** — CLI version now reads from `package.json` instead of being hardcoded

### Changed

- Replaced all `process.env.HOME` with `os.homedir()` (undefined on Windows)
- Replaced all hardcoded `.claude` paths with `getClaudeDir()` (auto-detects platform)
- Replaced all hardcoded `.claudestat` paths with `getClaudestatDir()` (respects `CLAUDESTAT_DATA_DIR` env var)
- Test script simplified: env vars set in `tests/index.ts` instead of shell-specific npm script
- Path regexes now handle both `/` and `\` separators (`/[/\\]/g` instead of `/\//g`)

### Fixed

- `claudestat --version` now shows correct version (was stuck at `0.2.1`)

## [0.2.5] - 2026-04-29

### Added

- Scan `~/.claude/skills/` (skills.sh) in System config alongside `~/.claude/commands/`
- `scanMarkdownDir` with `nested` param for subdirectory scanning

## [0.2.4] - 2026-04-29

### Added

- Doctor checks #8–#10: NVM/PATH prefix sanity, duplicate binary detection, version mismatch warning
- Startup NVM warning when running binary doesn't match npm global prefix
- `prepublishOnly` script ensures build before npm publish

### Fixed

- SystemView now scans `~/.claude/skills/` directory for skills.sh entries

## [0.2.0] - 2026-04-29

### Changed

- **Major refactor**: daemon.ts split into 9 modules (routes/events, routes/stream, routes/projects, routes/history, routes/misc, routes/reports, config, quota-tracker, weekly)
- Dashboard TracePanel split into 8 components
- Dashboard UsageView split into 7 components
- Tests expanded from 44 to 136

## [0.1.0] - 2026-04-25

### Added

- Initial release: daemon, dashboard, trace view, quota tracking, intelligence analysis
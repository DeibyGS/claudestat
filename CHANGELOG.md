# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
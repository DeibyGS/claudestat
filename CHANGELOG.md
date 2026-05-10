# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
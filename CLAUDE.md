# ClaudeStat — CLAUDE.md

Real-time execution trace and cost intelligence for Claude Code.
Daemon + React dashboard. Published as `@deibygs/claudestat`.

## Stack

- **Runtime**: Node.js 22+ (requires `node:sqlite` experimental API)
- **Language**: TypeScript, compiled via `tsc` + Vite (dashboard)
- **DB**: Native SQLite via `node:sqlite` (no external deps)
- **Dashboard**: React + Vite, served from `dist/` by the daemon
- **Test runner**: `node:test` (built-in)

## Commands

```bash
npm run build       # tsc + vite build
npm test            # node:test suite (153 tests)
node dist/index.js start    # start daemon on :7337
node dist/index.js stop     # stop daemon
node dist/index.js install  # install hooks into ~/.claude/settings.json
node dist/index.js doctor   # health check
node dist/index.js watch    # live terminal trace
```

## Architecture

```
src/
  daemon.ts          # Express server + SSE stream
  enricher.ts        # Watches ~/.claude/projects/ for new JSONL events
  db.ts              # SQLite ops (sessions, events, costs)
  paths.ts           # Cross-platform path resolution (~/.claude, encodeClaudePath)
  project-scanner.ts # Discovers projects from ~/.claude/projects/ JSONL
  quota-tracker.ts   # Token quota guard + kill switch
  install.ts         # Hook installer (writes ~/.claude/settings.json)
  routes/            # Express route handlers
  cache/             # projects-cache.ts (TTL cache for scan results)
dashboard/           # React + Vite frontend
hooks/
  event.js           # Hook script called by Claude Code on every event
tests/               # node:test suite
```

## Key invariants

- `tests/index.ts` uses `require()` (not `import`) — esbuild hoists static imports above env var assignments, breaking `:memory:` DB setup for tests.
- `encodeClaudePath()` replaces `/`, `\`, and `:` with `-`. On Windows `C:\Users\DGS` → `C--Users-DGS`.
- `getClaudeDir()` returns `~/.claude` on all platforms (including Windows — verified with Claude Code CLI v2.1.128).
- All db tests are wrapped in `describe({ concurrency: false })` — Node 22+ runs top-level `test()` concurrently.

## Windows notes

- No `fs.chmodSync` on hook scripts (not supported on Windows).
- Use `where` instead of `which`, `netstat` instead of `lsof`.
- Claude Code CLI stores data at `~/.claude/` (same as macOS/Linux).
- Project dirs use double-dash for drive letter: `C--Users-DGS`.

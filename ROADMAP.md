# Roadmap

This is the public roadmap for claudestat. Items move to the next release when the feature is merged and tests pass.

Priorities may shift based on community feedback. Open an issue or start a discussion to vote on features.

---

## v1.10.0 — Orchestration Command Center (current)

- [x] Orchestration Command Center v2 — swim-lane canvas with CC/OC rows
- [x] Run history DB — `orchestration_runs` table, snapshot per cycle
- [x] Cost + model + token breakdown per orchestration cycle
- [x] Real skill names captured from log (`→ Skill "name"`)
- [x] NodeCard: cost, model, files modified, skill badges per cycle
- [x] DetailPanel: token in/out/cache per agent (TokenRow)
- [x] Header totals: CC $X.XX · OC $X.XX = $total always visible
- [x] MCP weekly push notifications at 25/50/75/90/100% plan usage
- [x] MCP `get_daily_summary` tool with historical comparison
- [x] Dashboard live fixes: stale sessions, context notifications, LiveSourceBar status
- [x] Active-sessions: superseded session filtering (post-compaction heuristic)
- [x] Context window notifications per-session (no duplicate alerts across CC/OC)

---

## v1.11.0 — Dashboard polish

- [ ] Files modified inline in OC NodeCard (Fase 2.6)
- [ ] Logger module (`src/logger.ts`) — structured log levels, file rotation
- [ ] Webhook notifications — POST to configurable URL on loop detection or quota alert

---

## v1.12.0 — Export + Integrations

- [ ] Export date range filter — `--from` / `--to` in addition to `--since`
- [ ] Scheduled weekly email/webhook digest
- [ ] GitHub Actions integration — post usage summary as PR comment
- [ ] `claudestat compare <session-id> <session-id>` — side-by-side diff in terminal

---

## v2.0.0 — Extensibility

- [ ] Plugin API — register new tool sources without modifying core
- [ ] Binary releases — single-file executable via `bun build --compile` (no Node.js install required)
- [ ] Windows system service — NSSM-based equivalent of launchd/systemd setup

---

## Ideas backlog (no timeline)

- Mobile-friendly dashboard layout
- Cost budget per project (alert when a project exceeds N dollars/week)
- Session replay — step through tool calls with timestamps
- Dark/light mode toggle (dashboard currently uses system preference)
- `claudestat config --reset` to restore defaults without editing JSON

---

## Not planned

- Cloud sync or remote dashboards — claudestat is intentionally local-only
- Support for non-agentic AI tools (ChatGPT web, Gemini web) — out of scope
- GUI installer / app bundle — the CLI setup experience is preferred

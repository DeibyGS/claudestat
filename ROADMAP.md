# Roadmap

This is the public roadmap for claudestat. Items move to the next release when the feature is merged and tests pass.

Priorities may shift based on community feedback. Open an issue or start a discussion to vote on features.

---

## v1.12.x — Orchestration Command Center (current)

- [x] Orchestration Command Center v2 — swim-lane canvas with CC/OC rows
- [x] Run history DB — `orchestration_runs` table, snapshot per cycle
- [x] Cost + model + token breakdown per orchestration cycle (CC + OC)
- [x] Real skill names captured from log
- [x] NodeCard: cost, model, files modified, skill badges per cycle
- [x] DetailPanel: token in/out/cache per agent (TokenRow)
- [x] Header totals: CC $X.XX · OC $X.XX = $total always visible
- [x] MCP weekly push notifications at 25/50/75/90/100% plan usage
- [x] MCP `get_daily_summary` tool with historical comparison
- [x] Dashboard session filtering — real events, source grouping
- [x] Persistent alert state — survives daemon restarts
- [x] CC token count includes cache tokens (accurate cost-vs-token display)
- [x] Cycle trace persistence — `orch_cycle_traces` table survives log rotation
- [x] OC-REPORT.md fallback for files_changed in OC-only cycles
- [x] DeepSeek free-tier pricing detection with opencode.db cost passthrough

---

## v1.13.0 — Context window + CLI improvements

- [ ] Context window configurable — `KNOWN_CONTEXT_WINDOWS` currently hardcoded (Bug #10)
- [ ] Enterprise/Team plan detection in quota-tracker
- [ ] `claudestat status --json` — machine-readable status output
- [ ] `claudestat install --dry-run` — preview hooks without installing

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
- LinkedIn post + slides (Gamma.app) about claudestat Orchestrator tab
- Log rotation: log grows ~3.4MB/day, read whole file 15x every 3s — cache TTL 5s + maxLines 50K

---

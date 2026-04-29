<div align="center">

# claudestat

**Real-time execution trace and cost intelligence for Claude Code**

Hook into every tool call, token, and dollar — as it happens.
Works with Claude Pro, Max 5, and Max 20. Zero cloud dependencies. Pure Node.js. Runs everywhere.

[![npm version](https://img.shields.io/npm/v/@deibygs/claudestat?color=blue)](https://www.npmjs.com/package/@deibygs/claudestat)
[![npm downloads](https://img.shields.io/npm/dw/@deibygs/claudestat?color=blue)](https://www.npmjs.com/package/@deibygs/claudestat)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)]()
[![Tests](https://img.shields.io/badge/tests-44%2F44-brightgreen)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

[Installation](#installation) • [Quick Start](#quick-start) • [Commands](#commands) • [Dashboard](#dashboard) • [Contributing](#contributing)

![ClaudeStat dashboard](https://raw.githubusercontent.com/DeibyGS/claudestat/main/assets/ClaudeStat.png)

---

### See it in action

*Live dashboard · terminal trace · quota guard — all running in real time*

![claudestat demo](https://raw.githubusercontent.com/DeibyGS/claudestat/main/assets/demo.gif)

</div>

---

## Why?

Claude Code is powerful — but it's a black box while it runs. You can't see what it's spending, how deep the context is, whether it's looping, or if you're about to hit your quota limit.

**claudestat fixes that.** It taps into Claude Code's hook system to capture every event, stores it locally in SQLite, and shows you everything in a live dashboard or terminal trace.

- Live tool trace with duration and token cost per call
- Quota guard with configurable kill switch (block new sessions at X%)
- Pattern analyzer: detects loops, Bash overuse, low cache reuse, and more
- Per-session cost breakdown + cache savings + burn rate
- AI-generated weekly usage reports

---

## How it works

```
Claude Code event
      │
      ▼
  Hook script  (~/.claudestat/hooks/event.js)
      │  POST JSON to daemon
      ▼
  Daemon  (localhost:7337)
      │  stores events in SQLite
      │  enriches with JSONL token data from ~/.claude/projects/
      │  runs pattern analyzer
      ▼
  Dashboard  (React + Vite, auto-refreshes)
      │
      ▼
  You see everything — live
```

---

## Requirements

- **Node.js >= 18** (Node 22 recommended — uses `node:sqlite`)
- **Claude Code** installed (`npm install -g @anthropic-ai/claude-code`)

---

## Installation

```bash
npm install -g @deibygs/claudestat
```

Then wire up the hooks into Claude Code:

```bash
claudestat install
```

This modifies `~/.claude/settings.json` to add `SessionStart`, `PreToolUse`, `PostToolUse`, and `Stop` hooks. A backup is created at `~/.claude/settings.json.bak` before any change.

> Restart Claude Code after installing so the hooks take effect.

---

## Quick Start

```bash
# 1. Start the background daemon
claudestat start

# 2. Open the dashboard
open http://localhost:7337

# 3. Or watch a live terminal trace
claudestat watch
```

That's it. Start a Claude Code session and watch the events flow in.

---

## Commands

| Command | Description |
|---|---|
| `claudestat start` | Start the background daemon |
| `claudestat stop` | Stop the daemon |
| `claudestat restart` | Restart the daemon |
| `claudestat install` | Install hooks into Claude Code |
| `claudestat uninstall` | Remove hooks from Claude Code |
| `claudestat watch` | Live terminal trace view |
| `claudestat status` | Show quota, cost, and burn rate |
| `claudestat config` | View or edit configuration |
| `claudestat doctor` | Check installation health and diagnose issues |

### `claudestat watch`

Live terminal trace — every tool call as it happens, with duration and token cost.

```
claudestat watch

  ● Session a3f1bc · my-project · claude-sonnet-4-5

  16:42:01  Bash            342ms    1,240 tok   $0.0018
  16:42:03  Read             89ms      420 tok   $0.0006
  16:42:05  Edit            124ms      890 tok   $0.0013
  16:42:08  Agent (haiku)    2.1s    3,200 tok   $0.0024
  16:42:11  Write            67ms      310 tok   $0.0004

  Context: 42,800 / 200,000 (21%)  │  Session cost: $0.0065  │  🟢 healthy
```

### `claudestat status`

```
claudestat status

  Quota 5h   45/50 prompts (90%)  |  reset in 22m
  Plan        MAX5
  Sonnet      3.2h / 5h  this week
  Burn rate   1,240 tok/min
```

### `claudestat doctor`

Diagnoses common installation problems — useful if `claudestat start` fails or hooks are not firing.

```
claudestat doctor

🩺 claudestat doctor
──────────────────────────────────────────────
  ✓  Node.js version (22.17.0)
  ✓  Claude Code installed
  ✓  Hooks installed in Claude Code
  ✓  ~/.claudestat/ data directory exists
  ✓  Hook script deployed (~/.claudestat/hooks/event.js)
  ✓  Daemon running (localhost:7337)
  ✓  Global CLI symlink valid
──────────────────────────────────────────────
  All checks passed — claudestat is healthy!
```

If a check fails, `doctor` prints the exact fix command to run.

---

### `claudestat config`

```bash
# Enable kill switch — block new sessions when quota exceeds 95%
claudestat config --kill-switch true --threshold 95

# Force plan detection instead of auto
claudestat config --plan max5   # pro | max5 | max20 | auto
```

Config is stored at `~/.claudestat/config.json`.

---

## Dashboard

The dashboard lives at `http://localhost:7337` and has five tabs:

### Live
Real-time stream of every tool call in the active session. Shows tool name, duration, and token cost. Agent sub-calls expand into nested traces; Skill invocations collapse into labeled containers.

![Live tab](https://raw.githubusercontent.com/DeibyGS/claudestat/main/assets/live.png)

### History
All past sessions sorted by date. Each card shows total tokens (input + cache read + output), USD cost, efficiency score, and detected loops. Click any session to open its full tool trace, DAG view, and a compare panel.

![History tab](https://raw.githubusercontent.com/DeibyGS/claudestat/main/assets/history.png)

### Projects
Grid of every project you've worked on. Shows last active date, total sessions, cost, model usage breakdown (Sonnet / Haiku), and an efficiency progress bar.

![Projects tab](https://raw.githubusercontent.com/DeibyGS/claudestat/main/assets/projects.png)

### Analytics
- 6 KPIs: total cost, tokens, cache savings, hidden loop waste, avg efficiency, session count
- Token/cost trend charts (7 / 30 / 90 days)
- Hours by project
- AI-generated weekly reports (auto-scheduled or on demand)

![Analytics KPIs](https://raw.githubusercontent.com/DeibyGS/claudestat/main/assets/analitycsOne.png)

![Analytics charts](https://raw.githubusercontent.com/DeibyGS/claudestat/main/assets/analitycsTwo.png)

### System
Daemon health, DB size, Node version, config file paths, and memory context.

![System tab](https://raw.githubusercontent.com/DeibyGS/claudestat/main/assets/system.png)

---

## Configuration reference

Config is stored at `~/.claudestat/config.json` and created automatically on first run.

```json
{
  "killSwitchEnabled": false,
  "killSwitchThreshold": 95,
  "warnThresholds": [70, 85],
  "plan": null,
  "reportsEnabled": false,
  "reportFrequency": "weekly"
}
```

| Key | Default | Description |
|---|---|---|
| `killSwitchEnabled` | `false` | Enable the quota kill switch. When `true`, new Claude Code sessions are blocked once your quota reaches the threshold. Disabled by default — enable it only if you want hard quota enforcement. |
| `killSwitchThreshold` | `95` | Quota percentage (0–100) at which the kill switch activates. Only relevant when `killSwitchEnabled` is `true`. |
| `warnThresholds` | `[70, 85]` | Two quota percentages that trigger yellow and orange warnings in the dashboard sidebar. |
| `plan` | `null` | Force plan detection instead of auto. Valid values: `"pro"`, `"max5"`, `"max20"`. Leave `null` to let claudestat detect your plan from usage data. |
| `reportsEnabled` | `false` | Enable automatic AI-generated usage reports on a schedule. |
| `reportFrequency` | `"weekly"` | How often to generate reports. Valid values: `"weekly"`, `"biweekly"`, `"monthly"`. |

You can edit the file directly or use the CLI:

```bash
# Enable kill switch at 90% quota
claudestat config --kill-switch true --threshold 90

# Force plan (useful if auto-detect is wrong)
claudestat config --plan max5
```

---

## Roadmap

Planned for upcoming versions:

- **`claudestat export`** — export session data to CSV or JSON
- **`claudestat top`** — show top tools by cost and frequency across all sessions
- **Windows support** — currently macOS and Linux only
- **Multi-account support** — track usage across multiple Claude accounts
- **Slack / webhook alerts** — get notified when quota reaches warning thresholds
- **VS Code extension** — sidebar panel with live stats inside the editor

Have an idea? [Open an issue](https://github.com/DeibyGS/claudestat/issues) or submit a PR.

---

## Uninstall

```bash
claudestat uninstall        # removes hooks from ~/.claude/settings.json
npm uninstall -g @deibygs/claudestat
rm -rf ~/.claudestat        # removes DB, config, and PID file
```

---

## Contributing

**claudestat is open source and PRs are welcome.**

Whether you want to fix a bug, improve a dashboard view, add a new pattern to the analyzer, or support a new provider — contributions are encouraged.

### How to contribute

1. Fork the repository
2. Create a branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Run the test suite: `npm test` (44 tests — pattern analyzer + SQLite integration)
5. Open a PR with a clear description of what you changed and why

### Good first areas

- **Pattern analyzer** (`src/pattern-analyzer.ts`) — add new usage patterns or improve thresholds
- **Dashboard components** (`dashboard/src/components/`) — UI improvements, new charts, accessibility
- **New commands** — ideas like `claudestat export`, `claudestat compare`, `claudestat top`
- **Bug reports** — open an issue with steps to reproduce and your Node/OS version

### Running locally

```bash
git clone https://github.com/YOUR_USERNAME/claudestat
cd claudestat
npm install
npm run dev:full   # starts daemon + dashboard hot-reload together
npm test           # run all tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

---

## License

MIT — use it, fork it, ship it.

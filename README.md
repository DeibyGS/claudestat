<div align="center">

# claudestat

**Live AI coding monitor — real-time trace, quota guard, and MCP server**

Most tools read your logs after a session ends. claudestat hooks into every event as it fires.
See what your AI is spending right now, get alerted before you hit your quota, and ask Claude about its own usage — from inside the terminal.

Works with **Claude Code** and **OpenCode**. Zero cloud dependencies. Pure Node.js. Runs on macOS, Linux, and Windows.

[![npm version](https://img.shields.io/npm/v/@statforge/claudestat?color=blue)](https://www.npmjs.com/package/@statforge/claudestat)
[![npm downloads](https://img.shields.io/npm/dw/@statforge/claudestat?color=blue)](https://www.npmjs.com/package/@statforge/claudestat)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-brightgreen)]()
[![CI](https://github.com/DeibyGS/claudestat/actions/workflows/ci.yml/badge.svg)](https://github.com/DeibyGS/claudestat/actions/workflows/ci.yml)
[![Download](https://img.shields.io/badge/download-binary-blue)](https://github.com/DeibyGS/claudestat/releases/latest)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)
[![GitHub Issues](https://img.shields.io/github/issues/DeibyGS/claudestat)](https://github.com/DeibyGS/claudestat/issues)
[![GitHub Discussions](https://img.shields.io/github/discussions/DeibyGS/claudestat)](https://github.com/DeibyGS/claudestat/discussions)

[Installation](#installation) •
[Quick Start](#quick-start) •
[Commands](#commands) •
[Dashboard](#dashboard) •
[Library API](#library-api) •
[FAQ](#faq) •
[Discussions](https://github.com/DeibyGS/claudestat/discussions) •
[Contributing](#contributing)

![ClaudeStat banner](https://raw.githubusercontent.com/DeibyGS/claudestat/main/assets/banner.png)

### See it in action

*Live dashboard · terminal trace · quota guard — all running in real time*

![claudestat demo](https://raw.githubusercontent.com/DeibyGS/claudestat/main/assets/demoClaudestat.gif)

</div>

---

## Table of Contents

- [Why claudestat?](#why-claudestat)
- [Ask Claude about itself](#ask-claude-about-itself)
- [Features](#features)
- [Quick Start](#quick-start)
- [Requirements](#requirements)
- [Installation](#installation)
- [Commands](#commands)
- [Dashboard](#dashboard)
- [Library API](#library-api)
- [OpenCode Support](#opencode-support)
- [MCP Server](#mcp-server)
- [MCP Bundle (standalone)](#mcp-bundle-standalone)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Uninstall](#uninstall)
- [Contributing](#contributing)
- [License](#license)

---

## Why claudestat?

Tools like ccusage are great for reviewing history. claudestat is for *while you're coding*.

It taps into Claude Code's hook system to capture every event the moment it fires, stores everything locally in SQLite, and gives you a live dashboard, quota alerts, and an MCP server — not just a report.

| | claudestat | ccusage |
|---|:---:|:---:|
| Real-time event stream | ✅ | ❌ |
| Live terminal trace (`watch`) | ✅ | ❌ |
| Web dashboard | ✅ | ❌ |
| Quota alerts + kill switch | ✅ | ❌ |
| Loop detector | ✅ | ❌ |
| MCP server (ask Claude about itself) | ✅ | ❌ |
| MCP bundle (standalone, zero-config) | ✅ | ❌ |
| Historical usage analysis | ✅ | ✅ |
| Multi-CLI support (Codex, OpenCode, Amp, etc.) | ✅ | ✅ |

> If claudestat is useful, give it a ⭐ — it helps other developers find it.

---

## Ask Claude about itself

claudestat ships an MCP server. Once registered, you can ask Claude Code questions about its own usage — without leaving the terminal.

```bash
claude mcp add claudestat -s user -- claudestat-mcp
```

Then just ask:

```
> How much did I spend this week?
> What are my top 5 tools by cost?
> Break down my usage by model
> What's my cost projection for next month?
```

[Full MCP reference →](docs/MCP.md)

---

## Features

- **Live tool trace** — every call with duration and token cost as it runs
- **OpenCode support** — same live dashboard for OpenCode sessions (tool calls, prompts, model, intent)
- **Quota guard** — alerts at 70%, 85%, 95%; optional kill switch blocks new sessions at X%
- **Loop detector** — flags context thrashing with estimated waste cost
- **Top tools** — know which tools eat most of your budget; expandable "Other" row reveals tools beyond top 10
- **Cost projection** — linear regression with trend, confidence intervals, R²
- **Billing blocks** — track 5-hour billing windows and cumulative spend per block (`claudestat blocks`)
- **Session sharing** — export any session summary as formatted ASCII or JSON (`claudestat share`)
- **52-week activity heatmap** — visualize your coding activity across the full year in Analytics
- **Period-over-period deltas** — Analytics KPIs show ↑↓% trend vs. the previous period
- **Projects search & filter** — find projects instantly; filter by activity, cost, or efficiency threshold
- **Orchestration Command Center** — live swim-lane view of CC+OC multi-agent runs: per-cycle cost, tokens (with cache), files changed, git commits, and model breakdown; cycle traces survive log rotation
- **Web dashboard** — 7 tabs: Live, History, Projects, Analytics, Top, System, Orchestrate
- **MCP server** — 9 tools so Claude can answer questions about its own usage; standalone bundle available as `@statforge/claudestat-mcp-bundle`
- **Weekly insights** — pattern analysis with actionable tips
- **Multi-source** — switch between Claude Code and OpenCode sessions in one click
- **Source filter** — filter KPIs, charts, and tool rankings by Claude Code / OpenCode across all tabs
- **Multi-tool coordination** — live intent panel with real collision detection (same file edited by CC and OC)
- **Programmatic Library API** — import `dbOps`, pricing, and intelligence functions directly from your own tools (`v1.13.0+`, `@experimental`)

---

## Quick Start

```bash
npm install -g @statforge/claudestat && claudestat setup
open http://localhost:7337
```

Start a Claude Code session and watch the events flow in. That's it.

---

## Requirements

- **Node.js >= 22** (required for `node:sqlite`)
- **Claude Code** installed (`npm install -g @anthropic-ai/claude-code`)

---

## Installation

```bash
npm install -g @statforge/claudestat && claudestat setup
```

`claudestat setup` installs the Claude Code hooks and registers the daemon as a system service — no sudo required. The daemon starts automatically whenever you log in (launchd on macOS, systemd on Linux, Scheduled Task on Windows).

> **Using NVM?** Make sure you're on your default Node version:
> ```bash
> nvm use default && npm install -g @statforge/claudestat && claudestat setup
> ```
>
> Restart Claude Code after setup so the hooks take effect.

### Manual setup

```bash
npm install -g @statforge/claudestat
claudestat install   # installs hooks into Claude Code
claudestat start     # start the daemon manually
```

---

## Commands

| Command | Description |
|---------|-------------|
| `claudestat setup` | One-command setup: install hooks + register daemon as system service |
| `claudestat setup --uninstall` | Remove hooks and system service |
| `claudestat start` / `stop` / `restart` | Manage the background daemon |
| `claudestat install` / `uninstall` | Install or remove Claude Code hooks |
| `claudestat watch` | Live terminal trace view |
| `claudestat status` | Show quota, cost, and burn rate |
| `claudestat top` | Rank tools by cost, call count, or duration |
| `claudestat weekly` | Weekly usage summary |
| `claudestat insights` | Deep usage insights: cost, cache, efficiency, models |
| `claudestat project` | Cost projection with linear regression |
| `claudestat config` | View or edit configuration |
| `claudestat doctor` | Check installation health and diagnose issues |
| `claudestat blocks` | Show 5-hour billing block history |
| `claudestat share [session-id]` | Export session summary as ASCII or JSON (use `--copy` to copy to clipboard) |
| `claudestat export [format]` | Export session data to JSON or CSV |
| `claudestat roast` | Sarcastic usage analysis |
| `claudestat version` | Show version and check for updates |

[Full command reference with output examples →](docs/COMMANDS.md)

---

## Dashboard

The dashboard lives at `http://localhost:7337` and has seven tabs: **Live** (real-time trace with source badge, expandable Bash commands, and last-task subtitle per source), **History** (sessions by date with day selector 7/14/30/90d, merged-session badge, search, cost filter, and compare panel), **Projects** (grid with weekly heatmap, search input, and filters for active, high-cost, or low-efficiency projects), **Analytics** (spend + tokens + hours + efficiency KPIs with period-over-period ↑↓% deltas, stacked token chart by input/output/cache, 52-week activity heatmap, source filter, weekly AI reports), **Top** (tool rankings by cost/count/duration with cost projection and expandable "Other" row for tools beyond top 10), **System** (hooks, agents, skills, workflows, context file limits, work mode distribution, OpenCode config, memory files with truncation warning, claudestat config), and **Orchestrate** (multi-agent swim-lane view with per-cycle cost, tokens, files changed, git commits, and model breakdown).

![Live tab](https://res.cloudinary.com/dgscloudinary/image/upload/v1780428670/claudeStat/live_bc2z7j.png)

![History tab](https://res.cloudinary.com/dgscloudinary/image/upload/v1780428669/claudeStat/history_dzwweo.png)

![Projects tab](https://res.cloudinary.com/dgscloudinary/image/upload/v1780428649/claudeStat/projects_xhmizz.png)

![Analytics KPIs](https://res.cloudinary.com/dgscloudinary/image/upload/v1780428682/claudeStat/analitycs_td5hpv.png)

![Analytics charts](https://res.cloudinary.com/dgscloudinary/image/upload/v1780428683/claudeStat/analitycs2_ni2wwd.png)

![Top tab](https://res.cloudinary.com/dgscloudinary/image/upload/v1780428637/claudeStat/top_qytho3.png)

![System tab](https://res.cloudinary.com/dgscloudinary/image/upload/v1780428650/claudeStat/system_zeackp.png)

![Context notifications](https://res.cloudinary.com/dgscloudinary/image/upload/v1780428875/claudeStat/Captura_de_pantalla_2026-06-02_a_las_21.34.24_bee8k1.png)

[Dashboard details →](docs/DASHBOARD.md)

---

## OpenCode Support

When you run **OpenCode** alongside Claude Code, claudestat automatically detects both sessions and shows a source switcher in the Live tab.

Click between **Claude Code** and **OpenCode** to see each session's real-time view — tool calls, prompts, model name, intent badges, and timing — without leaving the dashboard.

| Feature | Claude Code | OpenCode |
|---|:---:|:---:|
| Tool calls (Read, Write, Bash, Edit…) | ✅ | ✅ |
| Prompts per block | ✅ | ✅ |
| Model name | ✅ | ✅ |
| Intent detection (Exploring / Implementing…) | ✅ | ✅ |
| Session cost | ✅ | ✅ |
| Weekly usage chart | ✅ | ✅ |
| Per-block cost breakdown | ✅ | — |
| Quota / context window | ✅ | — |

OpenCode data is read directly from its local SQLite database — no configuration required.

---

## MCP Server

claudestat includes an MCP server with 9 tools for querying usage stats. Register once:

```bash
claude mcp add claudestat -s user -- claudestat-mcp
```

Then ask Claude: *"What's my quota status?"*, *"Show me my latest session"*, *"Top 5 tools by cost"*, *"How's my context window doing?"*, *"What's my daily summary?"*.

The server also sends **push notifications** for context saturation (50/75/90%), weekly quota thresholds, and 5h billing cycle limits — Claude will proactively warn you without you asking.

Since **v1.16.0**, the MCP server runs on the **official `@modelcontextprotocol/sdk`** (v1.30.0) instead of a hand-rolled JSON-RPC engine. That means standards-compliant handshakes, protocol-version negotiation with modern MCP clients, reliable startup/shutdown on stdin EOF, and proper input validation for tool arguments. The public API is unchanged, so existing registrations keep working as-is.

![claudestat MCP demo](https://res.cloudinary.com/dgscloudinary/image/upload/v1780428703/claudeStat/MCP_claudestat_zgf7el.gif)

| Tool | Description |
|------|-------------|
| `get_quota_status` | 5h cycle %, weekly hours per model, burn rate, plan detection |
| `get_current_session` | Latest session cost, tokens, efficiency, loops |
| `get_session_stats` | Aggregated stats for the last N days |
| `get_top_tools` | Top 10 tools by cost, count, or duration |
| `get_usage_insights` | Cost per project, cache savings, output/input ratio, peak hours |
| `get_model_breakdown` | Cost and sessions broken down by Claude model |
| `get_weekly_insight` | Weekly summary with actionable tip |
| `get_context_status` | Current context window usage with saturation bar |
| `get_daily_summary` | Today vs yesterday vs 7d average |

[MCP tools reference →](docs/MCP.md)

## MCP Bundle (standalone)

Prefer a lighter dependency? Install the MCP server as a standalone package — no CLI, no daemon, just the stdio MCP server and its SQLite reader:

```bash
npm install -g @statforge/claudestat-mcp-bundle
claude mcp add claudestat -s user -- npx @statforge/claudestat-mcp-bundle
```

Same 9 tools, same context notifications, zero extra footprint.

[Bundle repo →](https://github.com/DeibyGS/claudestat-mcp-bundle)

---

## Library API

> **`@experimental` (v1.13.0+)** — the programmatic surface may change in any minor/patch release until v2.0.0. Pin to exact versions when integrating.

claudestat ships a TypeScript library entry alongside the CLI. Build exporters, alerters, and integrations that read session data directly — no `spawn`, no output parsing.

```ts
import { dbOps, analyzeSession, computeProjection, configure } from '@statforge/claudestat'

// Opt out of the daemon-required guard (CI / batch jobs):
configure({ throwOnNoDaemon: false })

const sessions = dbOps.getAllSessions(20)
const report   = analyzeSession(events, costUsd)
const forecast = computeProjection(30)
```

By default the first `dbOps.*` call probes `http://127.0.0.1:7337/health` and throws `DaemonNotRunningError` if the daemon is down. Pure functions (`findPricing`, `analyzeSession`, `computeProjection`, …) never probe.

| What | Stability |
|---|---|
| `dbOps` (15 read-only query functions) | `@experimental` — lazy daemon-guarded |
| Pricing tables (`MODEL_PRICING`, `KNOWN_CONTEXT_WINDOWS`, `PRICING`) | `@experimental` |
| Intelligence (`analyzeSession`, `detectLoops`, `predictSaturation`, …) | `@experimental` |
| Forecasting + quota (`computeProjection`, `computeQuota`, …) | `@experimental` |
| `configure({throwOnNoDaemon})` | `@experimental` |

[Full library reference + 3 worked examples →](docs/LIBRARY.md)

---

## Configuration

Config is stored at `~/.claudestat/config.json`. View it with `claudestat config` or edit the file directly.

```bash
claudestat config --kill-switch true --threshold 90
claudestat config --plan max5
claudestat config --alerts false
```

[Full configuration reference →](docs/CONFIG.md)

---

## How it works

```
Claude Code / OpenCode event
      │
      ▼
  Hook script  (~/.claudestat/hooks/event.js)
       │  POST JSON → daemon
       ▼
  Daemon  (localhost:7337)
       │  stores events in SQLite
       │  enriches with JSONL token data
       │  runs pattern analyzer
       │  context/quota push notifications
       ▼
  ┌──────────────────────────────────┐
  │  Dashboard (React + Vite)        │
  │  Terminal (claudestat watch)     │
  │  MCP Server (9 tools)            │
  │  Library API (dbOps, pricing)    │
  └──────────────────────────────────┘
              │
              ▼
  You see everything — live
```

---

## Troubleshooting

**`claudestat start` hangs for ~5 seconds**
Normal — `require('express')` takes a few seconds on first load. The daemon is running; wait for the "Daemon started" confirmation.

**Hooks are not firing / dashboard shows no events**
Run `claudestat doctor` — it checks every component and prints the exact fix command.

**`claudestat` command not found after install**
If using NVM, the binary may point to the wrong Node version:
```bash
nvm use default && npm install -g @statforge/claudestat && hash -r claudestat
```

**Kill switch is blocking new sessions**
Disable with `claudestat config --kill-switch false`, or wait for the 5h quota window to reset.

**Approaching rate limit**
The daemon polls quota every 60s and logs warnings at 70%, 85%, and 95%. Check anytime with `claudestat status`.

**Working with multiple projects**
claudestat tracks every project automatically. The Projects tab groups sessions by working directory.

**Dashboard shows 0 cost / $0.00 for all sessions**
Token data comes from Claude Code's JSONL files, not from hook events. Make sure Claude Code is writing JSONL logs — check `~/.claude/projects/` for `.jsonl` files. If the directory is empty, Claude Code may not have logging enabled.

**Daemon stops after terminal closes**
The daemon must be started with `nohup` to persist beyond the shell session:
```bash
nohup claudestat start &
```
Or use `claudestat setup` which installs a system service (launchd on macOS, systemd on Linux, Scheduled Task on Windows).

**`claudestat export` produces empty output**
If no sessions appear, the daemon may not have been running during your Claude Code sessions. Check `claudestat status` and restart with `claudestat start`. For historical data only (without a running daemon), export still reads from the local SQLite database — so past sessions captured while the daemon was running are always available.

**Loop detector fires too often / not enough**
Adjust the threshold and window:
```bash
claudestat config --loop-threshold 5   # default: 8 calls
claudestat config --loop-window 90     # default: 120 seconds
```

**MCP server not responding**
Restart the daemon (`claudestat restart`) and verify it's registered:
```bash
claude mcp list
```
If not listed, re-run: `claude mcp add claudestat -s user -- claudestat-mcp`

**OpenCode sessions not appearing**
claudestat reads OpenCode data from `~/.local/share/opencode/opencode.db`. If the file does not exist, OpenCode has not run yet or uses a different data path on your system. Run `opencode` at least once to initialize it.

**Node.js experimental SQLite warning on startup**
Expected — `node:sqlite` is experimental in Node 22. The warning is suppressed automatically. If you see it repeatedly, ensure you are running Node.js 22 or later (`node --version`).

## FAQ

**What is claudestat? How is it different from ccusage?**
claudestat is a real-time monitor for Claude Code — not a log reader. It hooks into every tool call as it fires, tracks token usage and cost live, guards your quota with configurable alerts, and exposes an MCP server. ccusage reads JSONL history after sessions end; claudestat runs while you code.

**How do I track Claude Code costs?**
Install with `npm install -g @statforge/claudestat && claudestat setup`, then open `http://localhost:7337` for the live dashboard. Use `claudestat status` for a quick summary or `claudestat export` for full data export.

**Does claudestat work with Claude Pro, Max 5, and Max 20?**
Yes. claudestat auto-detects your plan. You can also force it with `claudestat config --plan max5`.

**Is my data sent to any server?**
No. All data is stored locally in SQLite at `~/.claudestat/`. Zero cloud dependencies.

**Does claudestat work on Windows?**
Yes — macOS, Linux, and Windows are all supported. On Windows, `claudestat setup` registers a Scheduled Task for auto-start, clipboard uses `clip`, and the daemon health check uses Node's built-in HTTP client.

**What is the MCP bundle?**
`@statforge/claudestat-mcp-bundle` is a standalone npm package containing only the MCP server — no CLI, no dashboard, no daemon. Install it if you want Claude to query its own stats via MCP without running the full claudestat daemon.

**Can I use claudestat programmatically?**
Yes. Import `dbOps`, `computeProjection`, `analyzeSession`, `createMcpServer` and other functions directly from `@statforge/claudestat`. See the [Library API](#library-api) section.

---

## Uninstall

```bash
claudestat setup --uninstall                          # remove hooks + system service
rm -rf ~/.claudestat                                  # macOS / Linux
Remove-Item -Recurse -Force "$env:USERPROFILE\.claudestat"  # Windows (PowerShell)
```

> If you installed manually, use `claudestat uninstall` to remove only the hooks.
> On Windows, `claudestat setup --uninstall` also removes the Scheduled Task.

---

## Contributing

PRs are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

```bash
git clone https://github.com/YOUR_USERNAME/claudestat
cd claudestat
npm install
node --require tsx/cjs tests/index.ts   # run all tests
```

Good first areas: pattern analyzer (`src/pattern-analyzer.ts`), dashboard components (`dashboard/src/components/`), new commands.

---

## License

MIT — use it, fork it, ship it.

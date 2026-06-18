# claudestat — Command Reference

## Global flags

Available before any subcommand:

| Flag | Description |
|------|-------------|
| `-v, --verbose` | Enable verbose (debug) logging |
| `--version` | Show version number |
| `--help` | Show help |

---

## `claudestat start`

Start the background daemon.

```
claudestat start
claudestat start --watchdog
claudestat start --wait
claudestat start --verbose
```

| Option | Description |
|--------|-------------|
| `--watchdog` | Auto-restart daemon if it crashes (spawns separate watchdog process) |
| `--wait` | Wait until daemon responds on `/health` before returning (max 10s) |
| `-v, --verbose` | Enable verbose (debug) logging |

**Example:**
```
$ claudestat start
✅ claudestat daemon started (pid 12345)
   Dashboard → http://localhost:7337

$ claudestat start --watchdog
✅ Watchdog active (pid 12346)
   Dashboard → http://localhost:7337
```

---

## `claudestat stop`

Stop the claudestat daemon.

```
claudestat stop
```

Attempts graceful shutdown via `POST /shutdown` first, then falls back to `SIGTERM`.

**Example:**
```
$ claudestat stop
✅ claudestat daemon stopped
```

---

## `claudestat restart`

Restart the claudestat daemon.

```
claudestat restart
```

---

## `claudestat status`

Show current quota, cost, and burn rate.

```
claudestat status
claudestat status --json
```

| Option | Description |
|--------|-------------|
| `--json` | Output raw JSON instead of formatted text |

**Example:**
```
$ claudestat status

📊 claudestat  PRO plan
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  5h      ████████░░░░░░░░░░░░  42%   resets in 2h 15m

  Week    ██████████████░░░░░░  72%   resets Mon

  🔥 12,340 tok/min  ·  156 prompts used
```

---

## `claudestat config`

View or edit configuration.

```
claudestat config
claudestat config --kill-switch true --threshold 90
claudestat config --plan max5
```

| Option | Description |
|--------|-------------|
| `--kill-switch <bool>` | Enable/disable kill switch: `true` or `false` |
| `--threshold <number>` | Quota percentage to trigger kill switch (default: 95) |
| `--plan <plan>` | Force plan: `pro`, `max5`, `max20`, `auto` |
| `--alerts <bool>` | Enable/disable rate limit alerts |
| `--session-limit <usd>` | Alert when session exceeds this cost (0 = disabled) |
| `--kill-switch-force <bool>` | Hard-block on kill switch instead of warning |
| `--log-level <level>` | Set log level: `debug`, `info`, `warn`, `error` |
| `--loop-threshold <number>` | Tool calls in window to trigger loop detection |
| `--loop-window <seconds>` | Detection window in seconds |
| `--alias <path=name>` | Set a project alias: `--alias "/path/to/repo=MyApp"` |
| `--remove-alias <path>` | Remove a project alias |
| `--webhook <url>` | Set webhook URL for alerts. Use `"off"` to disable. |

**Example:**
```
$ claudestat config

⚙️  claudestat config
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Plan              AUTO
  Port              7337
  Alerts            enabled

  Kill switch       OFF
  Session limit     OFF
  Kill switch mode  warn-only
  Log level         INFO
  Loop detection    8 calls in 120s
  Webhook           off

  Cycle thresholds  70%, 85%, 95%
                    yellow ████░░  orange ██████░░  red ████████░░
```

---

## `claudestat watch`

Live terminal trace view.

```
claudestat watch
```

Opens a real-time SSE connection to the daemon. Displays tool calls as they fire.

---

## `claudestat top`

Rank tools by cost, frequency, or duration.

```
claudestat top
claudestat top --by cost --limit 10 --days 30
claudestat top --json
```

| Option | Description |
|--------|-------------|
| `--by <metric>` | Sort by: `cost`, `count`, `duration` (default: `cost`) |
| `--limit <number>` | Number of tools to show (default: 10) |
| `--days <number>` | Look back N days (default: 30) |
| `--json` | Output as JSON |

**Example:**
```
$ claudestat top --by cost --limit 5

🏆 claudestat top  by est. cost (last 30 days)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 1  Bash              ████████████████░░░░   $12.34    45%
     ░ 234 calls · 12.3m · avg/call $0.0527
 2  Read              ██████████░░░░░░░░░░   $5.67     21%
     ░ 89 calls · 3.2m · avg/call $0.0637
 3  Edit              ███████░░░░░░░░░░░░░   $3.21     12%
     ░ 45 calls · 2.1m · avg/call $0.0713
 4  Write             ████░░░░░░░░░░░░░░░░   $1.98     7%
     ░ 23 calls · 1.5m · avg/call $0.0861
 5  Grep              ██░░░░░░░░░░░░░░░░░░   $0.87     3%
     ░ 12 calls · 0.8m · avg/call $0.0725
```

---

## `claudestat weekly`

Show weekly usage summary.

```
claudestat weekly
claudestat weekly --json
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

---

## `claudestat insights`

Deep usage insights: cost breakdown, cache savings, efficiency, models.

```
claudestat insights
claudestat insights --days 14
claudestat insights --json
```

| Option | Description |
|--------|-------------|
| `--days <number>` | Look back N days (default: 7) |
| `--json` | Output raw JSON |

---

## `claudestat project`

Cost projection with linear regression.

```
claudestat project
claudestat project --days 180
claudestat project --json
```

| Option | Description |
|--------|-------------|
| `--days <number>` | Look back N days (default: 90) |
| `--json` | Output raw JSON |

---

## `claudestat blocks`

Show 5-hour billing block history.

```
claudestat blocks
claudestat blocks --limit 10
```

| Option | Description |
|--------|-------------|
| `--limit <n>` | Number of blocks to show (default: 20, max: 100) |

---

## `claudestat logs`

Show or tail the daemon log.

```
claudestat logs
claudestat logs -n 100
claudestat logs --follow
claudestat logs --level warn
```

| Option | Description |
|--------|-------------|
| `-n <number>` | Number of lines to show (default: 50) |
| `--follow` | Tail the log in real time |
| `--level <level>` | Filter by minimum level: `debug`, `info`, `warn`, `error` |

---

## `claudestat loops`

List sessions with detected loops (context thrashing).

```
claudestat loops
claudestat loops --days 7 --limit 5
claudestat loops --json
```

| Option | Description |
|--------|-------------|
| `--days <number>` | Look back N days (default: 30) |
| `--limit <number>` | Max sessions to show (default: 10) |
| `--json` | Output raw JSON |

---

## `claudestat export [format]`

Export session data.

```
claudestat export
claudestat export csv
claudestat export markdown --since 7d
claudestat export json --from 2026-01-01 --to 2026-06-01 --output sessions.json
```

| Argument / Option | Description |
|---|---|
| `format` | Output format: `json` (default), `csv`, `markdown` |
| `--from <date>` | Start date YYYY-MM-DD (inclusive) |
| `--to <date>` | End date YYYY-MM-DD (inclusive) |
| `--since <period>` | Shorthand: `7d`, `30d`, `90d` (overrides `--from`) |
| `--project <name>` | Filter by project path (case-insensitive substring) |
| `--output <path>` | Write to file (default: stdout) |

---

## `claudestat share [session-id]`

Export a session summary.

```
claudestat share
claudestat share abc123
claudestat share abc123 --format json --copy
```

| Option | Description |
|--------|-------------|
| `--format <fmt>` | Output format: `ascii` (default) or `json` |
| `--copy` | Copy output to clipboard (macOS only) |

---

## `claudestat doctor`

Check installation health.

```
claudestat doctor
```

Runs checks for: Node version, config file, hooks, PID file, daemon connectivity, SQLite DB, MCP registration.

---

## `claudestat roast`

Sarcastic usage analysis.

```
claudestat roast
claudestat roast --stats --months 3
```

| Option | Description |
|--------|-------------|
| `--stats` | Show raw stats only, no roast |
| `--months <n>` | Look back N months (default: 1) |

---

## `claudestat setup`

One-command setup: install hooks + register system service.

```
claudestat setup
claudestat setup --uninstall
claudestat setup --port 8337
claudestat setup --reset
```

| Option | Description |
|--------|-------------|
| `--uninstall` | Remove hooks and system service |
| `--port <number>` | Custom daemon port (default: 7337) |
| `--reset` | Reinstall from scratch (keeps SQLite history) |

---

## `claudestat install` / `uninstall`

Install or remove Claude Code hooks.

```
claudestat install
claudestat uninstall
```

---

## `claudestat resume`

Remove the pause signal — allows Claude Code to continue after a quota warning.

```
claudestat resume
```

---

## `claudestat version`

Show version and check for updates.

```
claudestat version
```

---

## `claudestat update`

Check for updates and install the latest version from npm.

```
claudestat update
claudestat update --dry-run
```

| Option | Description |
|--------|-------------|
| `--dry-run` | Only check for updates, do not install |

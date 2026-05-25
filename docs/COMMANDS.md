# claudestat Commands Reference

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

### `claudestat top`

Ranks your most-used tools by estimated cost, call count, or duration across all sessions.

```
claudestat top

🏆 claudestat top  by est. cost (last 30 days)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   1  Edit                ████████████████░░░░     $146.47  21%
     2479 calls · 38.5m
   2  Bash                ███████████████░░░░░     $140.66  20%
     2651 calls · 153.6m
   3  Read                ██████████████░░░░░░     $126.08  18%
     2315 calls · 34.0m
   4  Grep                ████░░░░░░░░░░░░░░░░      $39.93  6%
     699 calls · 9.3m
   5  ToolSearch          ██░░░░░░░░░░░░░░░░░░      $21.83  3%
     469 calls · 7.4m
   6  Glob                ██░░░░░░░░░░░░░░░░░░      $13.96  2%
     269 calls · 5.7m
   7  Write               █░░░░░░░░░░░░░░░░░░░      $12.93  2%
     237 calls · 87.1m
   8  mcp__plugin_engr…   █░░░░░░░░░░░░░░░░░░░       $8.10  1%
     149 calls · 2.6m
   9  Agent               █░░░░░░░░░░░░░░░░░░░       $8.09  1%
     168 calls · 95.7m
  10  WebFetch            █░░░░░░░░░░░░░░░░░░░       $5.86  1%
     106 calls · 9.9m
  Other                     —     $184.79  26%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Options: `--by cost|count|duration` · `--days 7|30|90` · `--limit N`

### `claudestat weekly`

Weekly usage summary with an actionable tip. Detects patterns like Bash overuse, low efficiency, high session count, and loop frequency.

```
claudestat weekly

📊 claudestat weekly  May 8 – May 13
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  💰  $198.38 total  ·  40 sessions  ·  114 loops

  🔧  Top tool    Bash  22% of cost

  📈  Efficiency    ██████████████████░░  91/100

  💾  Cache hit     ████████████████████  100%

  📦  Tokens  73K in + 1.2M out

  ⚡  Tip: 114 loops detected — consider using /compact earlier to prevent context thrashing

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Options: `--json` for machine-readable output.

### `claudestat status`

Shows your current quota usage with visual progress bars, plan detection, and burn rate.

```
claudestat status

📊 claudestat  PRO plan
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  5h      ████████████████████  100%   resets 4:10 AM

  Week    ██████░░░░░░░░░░░░░░  31%   resets May 18

  🔥 490 tok/min  ·  101 prompts used

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Options: `--json` for machine-readable output.

### `claudestat insights`

Deep usage insights: cost breakdown by project, cache savings, output/input ratio, efficiency trend, peak activity hours, and model breakdown.

```
claudestat insights

💡 claudestat insights  last 7 days
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  💰  $4.96/session  ·  40 sessions  ·  $198.38 total

  🗂  Top projects
     no project      █████████░░░░░░░░░░░  $93.69  47%
     claudestat      ████████░░░░░░░░░░░░  $74.60  38%
     wodrival        ███░░░░░░░░░░░░░░░░░  $24.95  13%
     aprendiendo-in  ░░░░░░░░░░░░░░░░░░░░  $3.32   2%
     other           ░░░░░░░░░░░░░░░░░░░░  $1.81   1%

  ⚡  Cache ~$1029.43 saved  ·  100% hit rate

  📊  16× output/input  ·  cache-heavy workload

  📈  Efficiency  91/100  ↓ -2 vs prev period  ·  114 loops

  ⏰  Activity by time of day
     🌙  00:00–05:59  ████████████████████  18 sessions
     🌅  06:00–11:59  ███████░░░░░░░░░░░░░   6 sessions
     ☀️  12:00–17:59  ███░░░░░░░░░░░░░░░░░   3 sessions
     🌆  18:00–23:59  ██████████████░░░░░░  13 sessions

  🤖  Models
     claude-sonnet-4-6             ████████████████████  $197.11  99% · 23 sessions
     claude-haiku-4-5-20251001     ░░░░░░░░░░░░░░░░░░░░  $1.26   1% · 15 sessions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Options: `--days 7|14|30|90` · `--json` for machine-readable output.

### `claudestat config`

View or edit your configuration.

```
claudestat config

⚙️  claudestat config
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Plan              PRO
  Alerts            enabled

  Kill switch       OFF
                    ████████████████████

  Cycle thresholds  70%, 85%, 95%
                    yellow ████████░░  orange █████████░  red ██████████

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

See [CONFIG.md](CONFIG.md) for the full reference.

### `claudestat project`

Cost projection with linear regression — weekly and monthly spend, trend direction, and 80% confidence intervals.

```
claudestat project

Cost Projection (R²=0.873, trend=↑ increasing)
──────────────────────────────────────────
  Weekly  | projected: $45.23  (80% CI: $32.10–$58.36)
          | avg $0.0048/day over 90 days
  Monthly | projected: $198.15  (80% CI: $140.50–$255.80)
          | avg $0.0048/day over 90 days
──────────────────────────────────────────
```

Options: `--days N` · `--json`

### `claudestat roast`

Get a sarcastic analysis of your Claude Code usage — humor with insights.

```bash
claudestat roast

🔥 Your Claude Code Roast  (30 days)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Score  ██████████████████░░  92/100  ★★★★★

  Scorecard
  ┌─────────────────┬──────────────┬──────────────┐
  │ Metric          │ Value        │ Rating       │
  ├─────────────────┼──────────────┼──────────────┤
  │ Sessions        │ 47           │ normal       │
  │ Total cost      │ $12.40       │ frugal       │
  │ Avg/session     │ $0.26/session│ efficient    │
  │ Bash calls      │ 1240         │ 🔨 overload  │
  │ Loops           │ 8            │ clean        │
  │ Efficiency      │ 92/100       │ 🏆 elite     │
  │ Tokens          │ 4.2M         │ —            │
  │ Top tool        │ Bash 38%     │ —            │
  └─────────────────┴──────────────┴──────────────┘

  Roast Cards

  ┌──────────────────────────────────────────────────┐
  │ 🖥️  BASH OVERLOAD                                │
  │ 1240 calls in 30d — once every 2.3 min           │
  │ Are you okay?                                    │
  └──────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────┐
  │ 🔄  LOOP MONEY PIT                               │
  │ $4.20 wasted on loops — that's 14 coffees        │
  │ Just saying.                                     │
  └──────────────────────────────────────────────────┘

  Verdict
  You're a machine. Or maybe you're just not using Claude enough.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  github.com/DeibyGS/claudestat
```

Options: `--stats` for raw stats · `--months N`

### `claudestat doctor`

Diagnoses common installation problems — run this first if something isn't working.

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
  ✓  No duplicate claudestat binaries in PATH
  ✓  Version match (installed: v1.3.0)
  ✓  NVM prefix matches active binary
  ✓  MCP server registered in Claude Code
──────────────────────────────────────────────
  All checks passed — claudestat is healthy!
```

### `claudestat version`

Shows the current version and checks npm for updates.

```bash
claudestat version

1.3.0
  latest ✓
```

If a newer version is available, it shows: `latest: 1.4.0 — run npm update`.

### `claudestat export`

Export session data to JSON or CSV. Supports date and project filters.

```bash
claudestat export                       # all sessions as JSON to stdout
claudestat export csv --output ~/sessions.csv
claudestat export json --from 2025-05-01 --to 2025-05-31
claudestat export csv --project myapp --output myapp-sessions.csv
claudestat export json --from 2025-05-01 --project claudestat --output may-claudestat.json
```

**Options:** `--from YYYY-MM-DD` · `--to YYYY-MM-DD` · `--project <name>` · `--output <path>`

Each row includes: `id`, `started_at`, `cwd`, `project_path`, `total_cost_usd`, `total_input_tokens`, `total_output_tokens`, `efficiency_score`, `loops_detected`, `source`.

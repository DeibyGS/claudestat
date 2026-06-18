# claudestat — Configuration Reference

Config is stored at `~/.claudestat/config.json`. You can view or edit it with `claudestat config` or modify the file directly.

---

## All config fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `killSwitchEnabled` | boolean | `false` | Activate/deactivate the blocking hook |
| `killSwitchThreshold` | number | `95` | Quota % to trigger kill switch (1–100) |
| `killSwitchForce` | boolean | `false` | Hard-block instead of just warning |
| `warnThresholds` | number[] | `[70, 85, 95]` | Cycle alert levels: yellow, orange, red |
| `weeklyWarnThresholds` | number[] | `[50, 75, 90]` | Weekly alert levels |
| `resetReminderMins` | number | `10` | Minutes before cycle reset reminder (0 = disabled) |
| `sessionCostLimitUsd` | number | `0` | Alert when session exceeds this cost (0 = disabled) |
| `plan` | string\|null | `null` | Force plan: `"pro"`, `"max5"`, `"max20"`, or `null` (auto) |
| `alertsEnabled` | boolean | `true` | Master switch for cycle + weekly + reset alerts |
| `reportsEnabled` | boolean | `false` | Enable automatic weekly reports |
| `reportFrequency` | string | `"weekly"` | Report frequency: `"weekly"`, `"biweekly"`, `"monthly"` |
| `reportDay` | number | `1` | Day of week for reports: 0=Sun, 1=Mon … 6=Sat |
| `reportTime` | string | `"09:00"` | Time to generate report (HH:MM) |
| `logLevel` | string | `"info"` | Log level: `"debug"`, `"info"`, `"warn"`, `"error"` |
| `port` | number | `7337` | Daemon HTTP port |
| `loopThreshold` | number | `8` | Tool calls in window to consider a loop |
| `loopWindowSecs` | number | `120` | Detection window in seconds |
| `projectAliases` | object | `{}` | `{"/path/to/repo": "MyApp"}` |
| `webhookUrl` | string\|null | `null` | Webhook URL for external alerts (`null` = disabled) |

---

## How to configure

### Via CLI

```bash
claudestat config --kill-switch true --threshold 90
claudestat config --plan max5
claudestat config --log-level debug
claudestat config --loop-threshold 5 --loop-window 90
claudestat config --alias "/Users/me/projects/myapp=MyApp"
claudestat config --webhook https://hooks.slack.com/services/...
```

### Via config file

```json
{
  "killSwitchEnabled": true,
  "killSwitchThreshold": 90,
  "plan": "max5",
  "logLevel": "info",
  "port": 7337,
  "projectAliases": {
    "/Users/me/projects/myapp": "MyApp"
  }
}
```

Only the fields you want to change need to be included. Missing fields use defaults.

---

## Quick reference

| Goal | Command |
|------|---------|
| View current config | `claudestat config` |
| Enable kill switch at 90% | `claudestat config --kill-switch true --threshold 90` |
| Force Max 5 plan | `claudestat config --plan max5` |
| Debug mode (verbose logs) | `claudestat config --log-level debug` |
| Disable alerts | `claudestat config --alerts false` |
| Set a project alias | `claudestat config --alias "/path/to/repo=MyApp"` |
| Remove an alias | `claudestat config --remove-alias "/path/to/repo"` |
| Set webhook for alerts | `claudestat config --webhook https://hooks.example.com/xyz` |
| Disable webhook | `claudestat config --webhook off` |
| Enable weekly reports | `claudestat config --reports-enabled true --report-frequency weekly` |

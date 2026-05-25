# claudestat Configuration Reference

Config is stored at `~/.claudestat/config.json` (macOS/Linux) or `%USERPROFILE%\.claudestat\config.json` (Windows). Created automatically on first run.

```json
{
  "killSwitchEnabled": false,
  "killSwitchThreshold": 95,
  "warnThresholds": [70, 85, 95],
  "plan": null,
  "alertsEnabled": true,
  "reportsEnabled": false,
  "reportFrequency": "weekly",
  "reportDay": 1,
  "reportTime": "09:00"
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `killSwitchEnabled` | `false` | Enable the quota kill switch. When `true`, new Claude Code sessions are blocked once your quota reaches the threshold. |
| `killSwitchThreshold` | `95` | Quota percentage (0–100) at which the kill switch activates. Only relevant when `killSwitchEnabled` is `true`. |
| `warnThresholds` | `[70, 85, 95]` | Three quota percentages for yellow, orange, and red warnings in the dashboard and daemon alerts. |
| `plan` | `null` | Force plan detection. Valid values: `"pro"`, `"max5"`, `"max20"`. Leave `null` to auto-detect. |
| `alertsEnabled` | `true` | Enable daemon rate limit alerts — polls quota every 60s and logs a warning (with optional desktop notification) when thresholds are crossed. |
| `reportsEnabled` | `false` | Enable automatic AI-generated usage reports on a schedule. |
| `reportFrequency` | `"weekly"` | How often to generate reports. Valid values: `"weekly"`, `"biweekly"`, `"monthly"`. |
| `reportDay` | `1` | Day of week for reports (0=Sun, 1=Mon … 6=Sat). |
| `reportTime` | `"09:00"` | Time of day (HH:MM) when the report is generated. |

## CLI

```bash
claudestat config                        # view current config
claudestat config --kill-switch true --threshold 90
claudestat config --plan max5
claudestat config --alerts false
```

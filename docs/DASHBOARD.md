# claudestat Dashboard

The dashboard lives at `http://localhost:7337` and has six tabs.

---

### Live

Real-time stream of every tool call in the active session. Shows tool name, duration, and token cost. Agent sub-calls expand into nested traces; Skill invocations collapse into labeled containers.

![Live tab](https://res.cloudinary.com/dgscloudinary/image/upload/v1778225605/My%20portfolio%7D/live_oeucqs.png)

---

### History

All past sessions sorted by date. Each card shows total tokens (input + cache read + output), USD cost, efficiency score, and detected loops. Click any session to open its full tool trace, DAG view, and a compare panel.

![History tab](https://res.cloudinary.com/dgscloudinary/image/upload/v1778225605/My%20portfolio%7D/history_gy4tpb.png)

---

### Projects

Grid of every project you've worked on. Shows last active date, total sessions, cost, model usage breakdown (Sonnet / Haiku), and an efficiency progress bar.

![Projects tab](https://res.cloudinary.com/dgscloudinary/image/upload/v1778225606/My%20portfolio%7D/projects_yeftby.png)

---

### Analytics

- **6 KPIs**: Real spend 7d, Real spend 30d, Tokens (period), Hours (period), Loops 7d, Avg efficiency
- **Source filter** — All / Claude Code / OpenCode; applies to every KPI and chart
- **Charts**: token/cost trend, model breakdown, tokens-per-day fluctuation (7 / 30 / 90 days)
- **Project hours** — bar chart synced to the same period selector as charts
- **Weekly reports** — AI-generated Markdown with CSS-styled checkboxes; auto-scheduled or on demand

![Analytics KPIs](https://res.cloudinary.com/dgscloudinary/image/upload/v1778225605/My%20portfolio%7D/analitycsOne_yx9tcp.png)

![Analytics charts](https://res.cloudinary.com/dgscloudinary/image/upload/v1778225604/My%20portfolio%7D/analitycsTwo_wzjsf2.png)

---

### Top

Tool rankings across all your sessions. Sortable by estimated cost, call count, or duration — with a time filter (7 / 30 / 90 days). Shows projected weekly and monthly spend based on linear regression.

![Top tab](https://res.cloudinary.com/dgscloudinary/image/upload/v1778225606/My%20portfolio%7D/top_pybyxy.png)

---

### System

Full configuration map for Claude Code and OpenCode:

- **Active tools** — live CC/OC status with real collision detection (same file edited by both tools)
- **Hooks** — SessionStart, PreToolUse, PostToolUse, Stop with command preview and tooltips
- **Agents** — list from `~/.claude/agents/` with descriptions
- **Skills** — CC skills from `~/.claude/commands/` and OC skills from `~/.config/opencode/skills/` with line-count warnings (limit: 500 ln)
- **Workflows** — pipeline definitions from `~/.claude/agents/workflows/`
- **Context files** — CLAUDE.md, MEMORY.md, settings.json with size/line usage vs recommended limits
- **Work modes** — Direct / Mini-pipeline / Full pipeline distribution (last 7 days)
- **OpenCode config** — model, large_model (if set), AGENTS.md stats, registered projects, plugins
- **Memory system** — Engram files in `~/.claude/projects/…/memory/`
- **claudestat config** — plan, kill switch status, quota alert thresholds

![System tab](https://res.cloudinary.com/dgscloudinary/image/upload/v1778225606/My%20portfolio%7D/system_ixurjb.png)

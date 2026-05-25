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

- 6 KPIs: total cost, tokens, cache savings, hidden loop waste, avg efficiency, session count
- Token/cost trend charts (7 / 30 / 90 days)
- Hours by project
- AI-generated weekly reports (auto-scheduled or on demand)

![Analytics KPIs](https://res.cloudinary.com/dgscloudinary/image/upload/v1778225605/My%20portfolio%7D/analitycsOne_yx9tcp.png)

![Analytics charts](https://res.cloudinary.com/dgscloudinary/image/upload/v1778225604/My%20portfolio%7D/analitycsTwo_wzjsf2.png)

---

### Top

Tool rankings across all your sessions. Sortable by estimated cost, call count, or duration — with a time filter (7 / 30 / 90 days). Shows projected weekly and monthly spend based on linear regression.

![Top tab](https://res.cloudinary.com/dgscloudinary/image/upload/v1778225606/My%20portfolio%7D/top_pybyxy.png)

---

### System

Daemon health, DB size, Node version, config file paths, and memory context.

![System tab](https://res.cloudinary.com/dgscloudinary/image/upload/v1778225606/My%20portfolio%7D/system_ixurjb.png)

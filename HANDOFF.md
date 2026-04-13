# HANDOFF — claudetrace

## Current Status
- Branch: `master`
- Último commit: `fix: context reset on compact + quota reset shows absolute time` (a9a2aac)
- **Phase 1 ✅** — hooks + daemon + CLI renderer
- **Phase 2 ✅** — SQLite, loop detection, enricher JSONL, visual upgrade CLI
- **Phase 3 ✅** — Dashboard React en http://localhost:7337
- **Phase 3.5 ✅** — KPIBar, meta-stats, project scanner Opción A, auto-compact
- **Phase 4 ✅** — Intelligence: state machine, quota 5h, burn rate, plan detection
- **Phase 5 ✅** — Git + PR + AI Summary (opcional con CLAUDETRACE_AI_SUMMARY=true)
- Hooks instalados en `~/.claude/settings.json` (SessionStart, PreToolUse, PostToolUse, Stop)
- Instalado globalmente: `npm install -g .` desde el directorio del proyecto

## Arquitectura Phase 1

```
Claude Code
    │
    ├── Hooks (PreToolUse/PostToolUse/Stop/SessionStart)
    │   └── node ~/.claudetrace/hooks/event.js → POST localhost:7337/event
    │
    ▼
Daemon (src/daemon.ts) — puerto 7337
    ├── POST /event  → store en memoria + broadcast SSE
    ├── GET  /stream → SSE para claudetrace watch
    ├── GET  /health → status del daemon
    └── GET  /sessions → debug

Store en memoria (src/db.ts)
    ├── Map<sessionId, Session>
    └── Map<sessionId, Event[]>
         └── Pairing Pre+Post → tipo "Done" con duration_ms

CLI watch (src/watch.ts)
    └── SSE client → renderTrace() → terminal ANSI tree
```

## Flujo de uso
1. Terminal A: `claudetrace start`
2. Terminal B: `claudetrace watch`
3. Usar Claude Code normalmente → el trace aparece en tiempo real

## Pending Tasks
- [x] **Phase 2** — SQLite, loop detection, enricher JSONL, visual upgrade CLI
- [x] **Phase 3** — Dashboard web (Vite + React, puerto 7337)
- [x] **Phase 3.5** — KPIBar + meta-stats + project scanner Opción A + auto-compact detection
- [x] **Phase 4** — Intelligence Layer
  - State machine de sesión: working → waiting_for_approval → waiting_for_input → idle
  - 5-hour quota tracking: prompts reales en ventana deslizante, tiempo hasta reset
  - Weekly limits por modelo (Sonnet vs Opus, horas reales)
  - Auto-detect plan: inferir tier (Pro/Max5/Max20) desde los JSONL
  - Burn rate: tokens/min en tiempo real + proyección de agotamiento
  - Dashboard: session states con colores en Live tab
  - Dashboard: Quota panel en KPIBar/footer
- [x] **Phase 5** — Git + PR + AI Summary
  - Git correlation: branch, dirty status, ahead/behind por proyecto
  - PR tracking: GitHub API para PR asociado + CI status
  - Cost per PR: anotar coste en git notes (hook post-commit)
  - AI session summary: Claude Sonnet resume cada sesión en 1-2 líneas
  - Dashboard: branch badges en SessionCard, summaries en HistoryView
- [ ] **Phase 6** — Kill Switch + Warnings + Status Line
  - Multi-level warnings: 70% amarillo, 85% naranja, 95% rojo (dashboard + SSE)
  - Kill switch: PreToolUse bloqueante (exit ≠ 0) al superar límite configurable
  - Status line: cuota 5h + coste sesión + tiempo hasta reset
  - Budget config: `~/.claudetrace/config.json` con límites y thresholds
- [ ] **Phase 7** — Publish
  - README completo: instalación, uso, screenshots, arquitectura
  - npm publish como `claudetrace`
  - CLAUDE.md global: instrucción para registrar proyectos nuevos automáticamente
  - On-boarding: mensaje en primer `claudetrace start` si no hay proyectos

## Gotchas críticos
- `better-sqlite3` da error de versión nativa en Node 22 → usar `node:sqlite` o in-memory
- Los hooks de Claude Code reciben JSON por stdin, no por args
- PostToolUse NO incluye tokens — el coste viene de los JSONL en ~/.claude/projects/
- NUNCA leer `~/.claude/history.jsonl` — contiene datos sensibles (API keys)
- El hook script debe siempre hacer `process.exit(0)` — nunca bloquear Claude

## Session Log
- **2026-04-13** — Proyecto iniciado. Análisis de ecosistema. Phase 1 MVP: daemon HTTP+SSE, store en memoria, CLI renderer, hooks.
- **2026-04-13** — Phase 2: SQLite (node:sqlite), loop detection, enricher JSONL + pricing. Visual upgrade: barra de contexto, bloques por respuesta, detección de modo, tokens K/M, badge de loop, barra eficiencia.
- **2026-04-13** — Phase 3: Dashboard Vite+React integrado en daemon puerto 7337. Componentes: Header (context bar), TracePanel (trace en vivo), DAGView (React Flow), StatsFooter (cost + Recharts weekly bar). Fix bugs: efficiency 0/100, semanal sin datos.
- **2026-04-13** — KPIBar + fixes: LOOP_THRESHOLD 4→8, loop penalty cap -40, processLatestForSession para contexto inmediato, meta-stats.ts + /meta-stats endpoint, KPIBar con sparklines (Engram/HANDOFF/Config/Contexto) + alertas semaforizadas.
- **2026-04-13** — Refactor proyecto como entidad central: project-scanner.ts, sessions.project_path, /projects + /history endpoints, 3 tabs (Live/Historial/Proyectos), SessionCard, HistoryView, ProjectCard (progreso HANDOFF %), ProjectsView con resumen global.
- **2026-04-13** — Auto-compact detection (drop context_used >50% desde >140K → SSE broadcast + banner UI). Project scanner reescrito con Opción A: lee file paths reales de JSONL → infiere raíz por marcadores (HANDOFF.md prioridad > .git > package.json). Fix deduplicación por inode (macOS case-insensitive). Detecta 8 proyectos únicos incluyendo claudetrace, wodrival, EvolutFit, gmail-ai-agent, CatcherAuto, conductor. HANDOFF parser ampliado para emojis (✅/🟡) y listas numeradas planas.
- **2026-04-13** — Análisis de 5 repos competidores (TylerGallenbeck, lugia19, 0xGeorgii, KyleAMathews, Maciek-roboblog). Roadmap replanteado a 4 fases grandes: Intelligence Layer → Git+PR+AI → Kill Switch+Status Line → Publish.
- **2026-04-13** — Phase 4: session-state.ts (state machine working/waiting/idle), quota-tracker.ts (ciclo 5h + weekly + burn rate + auto-detect plan), daemon.ts actualizado (map en memoria, SSE state_change, GET /quota), KPIBar con 3 nuevos cards (Estado+pulse, Quota 5h, Burn rate).
- **2026-04-13** — Phase 5: git.ts + github.ts + summarizer.ts. db.ts + ai_summary column. SessionCard con branch badge + AI summary. Endpoints /git y /pr. Summarizer opcional (ANTHROPIC_API_KEY, usa Haiku).
- **2026-04-13** — Bugs post-deploy: project cache con TTL 2min en daemon + pre-scan al arrancar. ProjectCard: 3 estados (sin tareas / todo pendiente / parcial). App.tsx: fetch proyectos al montar + refresh 60s. Quota reset: muestra hora absoluta local + "~". Contexto: se limpia tras compact_detected en lugar de quedarse congelado.

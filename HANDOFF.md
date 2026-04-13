# HANDOFF — claudetrace

## Current Status
- Branch: `master`
- Último commit: `feat: Phase 3 — dashboard Vite + React integrado en daemon`
- **Phase 1 ✅ COMPLETADA** — hooks + daemon + CLI renderer
- **Phase 2 ✅ COMPLETADA** — SQLite, loop detection, enricher JSONL, visual upgrade CLI
- **Phase 3 ✅ COMPLETADA** — Dashboard React en http://localhost:7337
- Hooks instalados en `~/.claude/settings.json` (SessionStart, PreToolUse, PostToolUse, Stop)

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
- [x] **Phase 3** — Dashboard web
  - Servidor React (Vite)
  - Grafo DAG en tiempo real (React Flow o D3)
  - WebSocket upgrade del SSE
  - Barra semanal: tokens acumulados esta semana desde stats-cache.json (sin % — límite no accesible localmente)
  - Investigar: claude-code source en npm para ver si expone límite semanal via endpoint local
- [ ] **Phase 4** — Git correlation
  - Hook post-commit que anota el coste de la sesión en git notes
- [ ] **Phase 5** — Kill switch de presupuesto
  - PreToolUse hook bloqueante (exit code ≠ 0) cuando se supera límite
- [ ] **Phase 6** — npm publish + README + docs

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

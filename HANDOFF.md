# HANDOFF — claudetrace

## Current Status
- Branch: `master`
- Último commit: `feat: Phase 1 MVP — real-time execution trace CLI`
- **Phase 1 COMPLETADA y funcional**
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
- [ ] **Phase 2** — SQLite persistence + inteligencia
  - Migrar store en memoria a SQLite (node:sqlite o better-sqlite3)
  - Algoritmo de detección de loops (mismo tool >3 veces en 60s)
  - Scoring de eficiencia por sesión
  - Enriquecimiento con coste desde JSONL de Claude Code
- [ ] **Phase 3** — Dashboard web
  - Servidor React (Vite)
  - Grafo DAG en tiempo real (React Flow o D3)
  - WebSocket upgrade del SSE
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
- **2026-04-13** — Proyecto iniciado. Análisis de ecosistema (ccusage, claude-usage, etc.). Decidido enfoque diferenciador: distributed tracing + cost intelligence. Phase 1 MVP completa: daemon HTTP+SSE, store en memoria, CLI renderer ANSI, instalador de hooks.

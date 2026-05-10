# GROWTH — claudestat

> Guía de referencia completa para el crecimiento de claudestat.
> Actualizar checkboxes al completar cada tarea.
> Revisar al inicio de cada sesión de growth.

---

## Estado actual (baseline)

| Métrica | Valor inicial | Objetivo 90 días |
|---------|--------------|-----------------|
| npm downloads/semana | — | 500+/semana |
| GitHub stars | — | 200+ |
| npm version | 1.0.0 (@deibygs) | 1.x.x (@statforge) |
| Awesome lists | 0 | 5+ |
| Artículos publicados | 0 | 6+ |
| Canales activos | 0 | LinkedIn, Dev.to, Reddit |
| Donaciones/sponsors | 0 | GitHub Sponsors activo |

> Actualiza los valores reales antes de empezar la Fase 0.

---

## Decisiones tomadas

| Decisión | Estado |
|----------|--------|
| Crear org `@statforge` en npm y republicar | ✅ Acordado |
| Presupuesto: 100% orgánico/free | ✅ Confirmado |
| Canales: LinkedIn, Dev.to, Reddit (activos) | ✅ Confirmado |
| X/Twitter: no prioritario por ahora | ✅ Excluido fase 1 |
| Donaciones: GitHub Sponsors | ✅ Acordado |
| Contenido: usar datos reales de uso propio | ✅ Confirmado |
| Ejecución: solo, posibles colaboradores en futuro | ✅ Confirmado |

---

## Diagnóstico — Barreras actuales

Problemas identificados en orden de impacto:

1. **Scope `@deibygs/`** — genera fricción de confianza. Un dev que no conoce el autor lo percibe como proyecto personal/abandonable.
2. **Node >= 22** — muchos devs en Node 18/20 LTS. Bloquea silenciosamente. El troubleshooting existe pero el daño ya está hecho.
3. **9 keywords en package.json** — límite real es ~32. Se dejan 23 slots de discoverabilidad vacíos.
4. **Sin social proof** — 0 menciones públicas, 0 artículos, 0 posts.
5. **Sin funding/donations setup** — no hay botón Sponsor en GitHub.
6. **Topics de GitHub** — probablemente vacíos o mínimos.
7. **Sin awesome lists** — principal canal de descubrimiento orgánico para CLI tools.
8. **README** — bueno técnicamente, pero sin hook emocional ni CTAs de conversión.

---

## Fortalezas a explotar

- **Primero en el nicho**: no hay herramienta establecida de observabilidad para Claude Code.
- **Zero cloud deps**: privacidad total — argumento poderoso para devs enterprise.
- **Hook nativa**: usa el sistema oficial de hooks de Claude Code (no scraping).
- **All-in-one**: daemon + dashboard + CLI en un solo package.
- **Datos reales propios**: semanas de uso = contenido auténtico disponible.
- **208 tests + CI**: credibilidad técnica alta.
- **Dashboard visual**: screenshots compartibles.

---

## Posicionamiento definitivo

> **"The standard observability layer for Claude Code"**
>
> The htop you wish Claude Code had.

**Frases a repetir en TODO el contenido (SEO + LLM retrieval):**
- `claude code monitoring`
- `claude code token tracking`
- `claude code observability`
- `claude code cost analytics`
- `claude code quota guard`
- `ai agent cost control`
- `claude code dashboard`

---

# FASE 0 — Foundation
> Objetivo: dejar la base técnica y de distribución correcta antes de cualquier contenido.
> Tiempo estimado: 1 sesión (2-3h)

## 0.1 Migración a @statforge

- [x] Crear cuenta org `@statforge` en npmjs.com
- [ ] Crear org `statforge` en GitHub (o usar como namespace)
- [x] Publicar `@statforge/claudestat` (v1.0.1)
- [x] Deprecation notice en `@deibygs/claudestat@1.0.0`
- [x] Actualizar todas las referencias internas al nuevo scope
- [ ] Actualizar links en portfolio y cualquier mención pública

**Deprecation notice para @statforge/claudestat:**
```
⚠️ This package has moved to @statforge/claudestat
npm install -g @statforge/claudestat
```

## 0.2 SEO técnico — npm + GitHub

**package.json — keywords (reemplazar los 9 actuales):**
- [x] Actualizar keywords a:
```json
"keywords": [
  "claude-code", "claude", "anthropic", "claude-monitoring",
  "token-tracker", "cost-tracker", "ai-observability",
  "claude-dashboard", "quota-guard", "rate-limit",
  "ai-agent", "llm-cost", "token-usage", "claude-hooks",
  "ai-productivity", "terminal-dashboard", "developer-tools",
  "cli", "monitoring", "analytics", "claude-pro", "claude-max",
  "ai-coding", "agentic-workflow", "observability"
]
```

**package.json — description (reemplazar):**
- [x] Cambiar a:
```
"Observability layer for Claude Code — live token tracking, cost analytics, quota guard, loop detection, and usage dashboard. The htop for Claude Code."
```

**package.json — funding:**
- [x] Añadir:
```json
"funding": {
  "type": "github",
  "url": "https://github.com/sponsors/DeibyGS"
}
```

**GitHub — topics:**
- [ ] Ir a repo → About → Topics y añadir:
```
claude-code, anthropic, claude, ai-tools, observability,
token-tracking, cost-analytics, developer-tools, cli,
dashboard, monitoring, react, typescript, sqlite,
ai-productivity, llm-tools, claude-hooks, quota-management,
agentic-workflow, terminal
```

**GitHub — features:**
- [ ] Habilitar Discussions
- [ ] Habilitar Sponsorships (si disponible)

## 0.3 GitHub Sponsors / Donaciones

- [ ] Activar GitHub Sponsors en perfil DeibyGS
- [ ] Crear `.github/FUNDING.yml`:
```yaml
github: [DeibyGS]
```
- [ ] Añadir badge de Sponsor en README (sección top)
- [ ] Añadir CTA de donación en README: "If claudestat saved you tokens or money, consider sponsoring ❤️"

## 0.4 README — mejoras de conversión

- [x] Añadir CTA de ⭐ estrella explícito después del install:
  > "If claudestat is useful, give it a ⭐ — it helps others find it."
- [x] Añadir hook emocional ANTES del "How it works"
- [ ] Mover screenshots a posición más alta (antes del diagrama técnico)
- [x] Añadir sección FAQ semántica (para LLM retrieval)
- [x] Actualizar todos los links al nuevo scope @statforge

## 0.5 llms.txt

- [x] Crear `/llms.txt` en raíz del repo:
```
# claudestat
> Real-time token monitoring and cost dashboard for Claude Code

claudestat is an open-source CLI tool that provides observability
for Claude Code sessions. It tracks token usage, API costs, quota
consumption, and detects inefficiency patterns like loops and
excessive context usage.

## Installation
npm install -g @statforge/claudestat

## Key capabilities
- Real-time token cost tracking per tool call
- Quota guard with configurable kill switch
- Loop detection and pattern analysis
- Per-session cost breakdown with cache savings
- CLI commands: start, stop, watch, status, top, export, doctor

## Use cases
- Monitor Claude Code token usage in real time
- Track AI coding costs per session and project
- Get alerted before hitting quota limits
- Detect inefficient patterns (loops, context overuse)
- Export usage data for analysis or reporting

## Keywords
claude code monitoring, token tracking, AI cost analytics,
quota management, claude code dashboard, ai observability,
claude code hooks, rate limit detection, llm cost tracker
```

---

# FASE 1 — Awareness (Semana 1-2)
> Objetivo: primeras menciones públicas reales. Conseguir las primeras 50 stars y primeras 200 descargas/semana orgánicas.

## 1.1 Reddit — Post principal

**Target:** r/ClaudeAI (primera prioridad), r/LocalLLaMA, r/commandline

**Template de post para r/ClaudeAI:**
```
Title: "I built a real-time monitoring tool for Claude Code —
        live token costs, loop detection, quota guard"

Body:
I got tired of finishing a long Claude Code session with no idea
what it had spent, or finding out it had been looping for 20 minutes
burning my Max5 quota while I was away from keyboard.

So I built claudestat — a background daemon that hooks into Claude Code
and gives you a live dashboard.

[GIF del dashboard]

What it shows:
- Every tool call with duration + estimated cost in real time
- Context usage % (see the context approaching the wall before it does)
- Which tools are eating your quota (spoiler: usually Bash)
- Kill switch: automatically block new sessions when you hit X% quota

After several weeks using it on my own workflow, I found:
- [DATO REAL: ej. "23% of tokens went to loops I didn't notice"]
- [DATO REAL: ej. "Bash was 38% of my total cost"]
- [DATO REAL: ej. "12 sessions hit 90%+ context"]

Open source, zero cloud deps, all data stays local in SQLite.

npm install -g @statforge/claudestat

Would love feedback — especially from Max5/Max20 users who hit limits often.
```

- [ ] Extraer datos reales propios (ver sección "Datos para contenido" abajo)
- [ ] Post en r/ClaudeAI
- [ ] Post en r/LocalLLaMA (versión más técnica, mencionar la arquitectura)
- [ ] Post en r/commandline (enfocado en el terminal UX y watch command)

## 1.2 Dev.to — Artículo 1 (storytelling)

**Título:** `"I had no idea Claude Code was looping for 20 minutes — so I built a monitor"`

**Estructura:**
1. El problema (historia personal real)
2. Lo que descubrí en mis primeras semanas de uso
3. Cómo funciona claudestat (con screenshots)
4. Setup en 2 minutos
5. Lo que encontrarás en tu propio uso
6. Link al repo / npm

**Keywords a incluir naturalmente:**
- claude code monitoring, token usage tracking, claude code dashboard, quota management

- [ ] Extraer 3-5 datos reales impactantes de tu uso
- [ ] Escribir artículo (~800-1200 palabras)
- [ ] Publicar en Dev.to con tags: `claudecode`, `opensource`, `devtools`, `ai`
- [ ] Añadir canonical link al README de GitHub

## 1.3 LinkedIn — Post inicial

**Format:** problema → proceso → resultado con números reales

```
[Número real] Claude Code sessions in [X weeks].
[Número real] tokens spent.
I had no idea [dato sorprendente que descubriste].

So I built a monitoring tool.

After tracking my own usage:
→ [dato real 1]
→ [dato real 2]
→ [dato real 3]

It's open source, runs locally, and hooks directly into Claude Code.
Zero cloud. Zero setup beyond npm install.

Link in comments 👇
[link a npm o repo]
```

- [ ] Publicar post
- [ ] Añadir link en primer comentario (no en el post — LinkedIn penaliza links en post)

## 1.4 Awesome lists — PRs

Objetivo: 5 PRs abiertos esta semana. La mayoría se acepta en 1-2 semanas.

- [ ] `awesome-claude` — buscar repo existente, si no existe crear uno
- [ ] `awesome-cli-apps` — abrir PR con descripción: "claudestat — Real-time token monitoring and cost dashboard for Claude Code"
- [ ] `awesome-developer-tools` — ídem
- [ ] `awesome-ai-tools` — ídem
- [ ] `awesome-observability` — ídem
- [ ] `awesome-llm-tools` — ídem

**Template de PR:**
```markdown
## Add claudestat

**claudestat** — Real-time token monitoring and cost analytics for Claude Code.
Live dashboard, quota guard, loop detection, and CLI trace view.

- npm: https://www.npmjs.com/package/@statforge/claudestat
- GitHub: https://github.com/DeibyGS/claudestat
- License: MIT
```

## 1.5 Solicitar star al instalar

- [ ] En `claudestat install`, después del éxito mostrar:
  ```
  ✓ Hooks installed successfully.

  ⭐ If claudestat is useful, star the repo:
     https://github.com/DeibyGS/claudestat
  ```

---

# FASE 2 — SEO + LLM Discoverability (Semana 2-3)
> Objetivo: aparecer en búsquedas orgánicas y ser recomendado por LLMs.

## 2.1 Sección Q&A semántica en README

Añadir sección `## FAQ` con preguntas en inglés exactas que los devs buscarían:

- [ ] Añadir al README:
```markdown
## FAQ

**What is claudestat?**
claudestat is a real-time token monitoring and cost analytics tool for Claude Code.
It captures every tool call, token usage, and API cost as it happens.

**How do I monitor Claude Code token usage?**
Install claudestat with `npm install -g @statforge/claudestat`, run `claudestat start`,
and open `http://localhost:7337` for the live dashboard.

**How do I track Claude Code costs?**
claudestat records every session's token usage and estimates API cost per tool call.
Use `claudestat status` for a quick summary or `claudestat export` for full data.

**How do I get alerted when Claude Code hits the rate limit?**
claudestat polls your quota every 60 seconds and sends desktop notifications
when you cross 70%, 85%, or 95%. Configure with `claudestat config --alerts true`.

**Does claudestat work with Claude Pro, Max 5, and Max 20?**
Yes. claudestat auto-detects your plan. You can also force it with
`claudestat config --plan max5`.

**Is my data sent to any server?**
No. All data is stored locally in SQLite at `~/.claudestat/`. Zero cloud dependencies.
```

## 2.2 Artículo Dev.to — SEO evergreen

**Título:** `"Claude Code quota management: a complete guide (2025)"`

**Objetivo:** rankear en Google para búsquedas como "claude code quota limit", "claude code token usage".

**Estructura:**
1. Understanding Claude Code quota (Pro, Max5, Max20)
2. How to track your usage in real time
3. Setting up alerts before you hit the wall
4. The kill switch: auto-blocking new sessions
5. Analyzing which tools cost the most
6. Exporting data for reporting

- [ ] Escribir artículo (1500-2000 palabras, denso en keywords)
- [ ] Publicar con tags: `claudecode`, `ai`, `productivity`, `tutorial`

## 2.3 Artículo Dev.to — Data-driven

**Título:** `"I analyzed my Claude Code sessions for 30 days. Here's what I found."`

**Usa tus datos reales.** Este es el artículo más poderoso porque nadie más tiene estos datos.

**Estructura:**
1. Setup y metodología
2. Los números (tokens, costo, tools más usados)
3. El hallazgo más sorprendente (dato real tuyo)
4. Patrones que detecté (loops, picos de contexto)
5. Cómo cambié mi workflow después
6. Tool que usé para analizar esto

- [ ] Preparar datos (exportar con `claudestat export` + analizar)
- [ ] Escribir artículo
- [ ] Publicar

## 2.4 Responder issues/discusiones externas

- [ ] Buscar en GitHub issues del repo `anthropic-ai/claude-code` donde usuarios pregunten sobre costos/monitoring → responder con claudestat
- [ ] Buscar en Reddit posts sobre "claude code cost", "claude quota" → responder útilmente mencionando claudestat
- [ ] Crear una Discussion en el repo: "How are you using claudestat? Share your stats" — genera UGC (user generated content)

---

# FASE 3 — Features Virales (Semana 3-6)
> Objetivo: añadir features que generen sharing orgánico y creen hábito.

## 3.1 `claudestat share` — Session card

**Descripción:** Al final de cada sesión (o bajo demanda), genera una tarjeta ASCII art + PNG compartible.

```
╔═══════════════════════════════════╗
║     Session Report · claudestat   ║
╠═══════════════════════════════════╣
║  Project     my-project           ║
║  Duration    2h 14m               ║
║  Tools       847 calls            ║
║  Cost        $0.84                ║
║  Cache hit   27% saved ($0.31)    ║
║  Top tool    Bash (38%)           ║
║  Efficiency  91 / 100 ⭐           ║
╚═══════════════════════════════════╝
  github.com/DeibyGS/claudestat
```

**Por qué es viral:** mismo mecanismo que Spotify Wrapped. Los devs van a postear esto.

- [ ] Spec (`/sdd`) antes de implementar
- [ ] Implementar `claudestat share [--format ascii|json]`
- [ ] Copiar al clipboard automáticamente en macOS (`pbcopy`)
- [ ] Documentar en README con ejemplo

## 3.2 `claudestat roast` — Humor viral

**Descripción:** Analiza los peores hábitos de uso y los dice de forma sarcástica.

```
🔥 Your Claude Code Roast

  You called Bash 1,240 times last month.
  That's once every 2.3 minutes.
  Are you okay?

  You hit 90%+ context in 12 sessions.
  Claude was writing with amnesia half the time.

  You spent $4.20 on loops you never noticed.
  That's 14 coffees. Just saying.

  Efficiency score: 67/100 — room for growth, champ.
```

**Por qué funciona:** el humor es el mayor vector de sharing en Twitter para dev tools.

- [ ] Spec antes de implementar
- [ ] Implementar `claudestat roast`
- [ ] Postear tu propio roast como contenido de lanzamiento del feature

## 3.3 tmux status bar integration

**Descripción:** one-liner documentado para mostrar el status en tmux.

```bash
# ~/.tmux.conf
set -g status-right "#(claudestat status --compact 2>/dev/null) | %H:%M"
```

Output: `Quota 46% · $0.42 · 🟢 | 16:42`

- [ ] Implementar flag `--compact` en `claudestat status`
- [ ] Documentar en README sección "Integrations"
- [ ] Crear GIF mostrando tmux con claudestat en status bar

## 3.4 Insights automáticos semanales

**Descripción:** al abrir terminal (si el daemon está corriendo), mostrar un resumen semanal una vez por semana.

```
claudestat weekly insight:
  This week: $12.40 · 47 sessions · 3 loops detected
  Your most expensive tool: Bash (41%)
  Tip: Group bash commands to reduce call count
```

- [ ] Spec antes de implementar
- [ ] Implementar weekly insight en daemon (muestra al iniciar la semana)

---

# FASE 4 — Comunidad e Integraciones (Mes 2-3)
> Objetivo: crecimiento sostenible, integraciones que generan instalaciones indirectas.

## 4.1 MCP Server de claudestat

**Descripción:** un MCP server que permite a Claude preguntarse a sí mismo "¿cuánto llevo gastado en esta sesión?". Meta-viralidad: Claude monitoreándose a sí mismo.

Herramientas MCP expuestas:
- `get_current_session_cost` → retorna costo y tokens de la sesión activa
- `get_quota_status` → retorna uso de quota actual
- `get_top_tools` → retorna ranking de tools más usados

- [ ] Spec antes de implementar
- [ ] Implementar MCP server en `src/mcp.ts`
- [ ] Documentar setup en README sección "MCP Integration"
- [ ] Post específico sobre esto: "Claude can now monitor itself with claudestat MCP"

## 4.2 Contactar Anthropic DevRel

**Objetivo:** conseguir mención en docs oficiales o newsletter de Claude Code.

- [ ] Preparar pitch de 3 párrafos:
  - Qué es claudestat
  - Por qué es valioso para la comunidad Claude Code
  - Solicitar: mención en "community tools" en docs, o retweet, o newsletter
- [ ] Buscar contacto DevRel de Anthropic (Twitter, LinkedIn, Discord oficial)
- [ ] Enviar mensaje directo, no spam público

## 4.3 PR a docs de Claude Code

- [ ] Buscar si el repo `anthropic-ai/claude-code` tiene una sección de herramientas de la comunidad
- [ ] Abrir PR añadiendo claudestat con descripción de 2 líneas
- [ ] Si no hay sección, abrir issue sugiriendo crearla (y ofrecer hacer el PR)

## 4.4 VS Code Extension (MVP)

**Descripción:** sidebar panel que muestra `claudestat status` en tiempo real dentro del editor.

- [ ] Investigar API de VS Code para webview panels
- [ ] Spec antes de implementar
- [ ] MVP: mostrar quota %, costo de sesión actual, y estado del daemon
- [ ] Publicar en VS Code Marketplace como `claudestat-vscode`

## 4.5 Contributors — estructura

- [ ] Crear issues con labels `good-first-issue`:
  - "Add new pattern detector: [description]"
  - "Improve error message for Node version mismatch"
  - "Cursor integration research"
  - "Add --compact flag to more commands"
- [ ] Crear `CONTRIBUTING.md` detallado si no existe
- [ ] Añadir sección "Contributors" en README con avatars (via all-contributors)

---

# Datos para contenido

> Extraer estos datos con `claudestat export --format json` y analizarlos.
> Son la materia prima de todo el contenido auténtico.

- [ ] Total de sesiones en las últimas semanas
- [ ] Costo total estimado
- [ ] Tool más usada (por llamadas)
- [ ] Tool más cara (por costo estimado)
- [ ] % del costo que fue a Bash
- [ ] Número de loops detectados
- [ ] Sesiones donde el contexto superó el 80%
- [ ] Cache hit rate promedio
- [ ] Efficiency score promedio
- [ ] Sesión más cara (cuánto costó, qué hizo)
- [ ] Dato más sorprendente / inesperado

---

# Plan de contenido 30 días

| Día | Canal | Contenido | Estado |
|-----|-------|-----------|--------|
| 1 | npm + GitHub | Fase 0 completa (scope, keywords, topics) | [ ] |
| 2 | Reddit r/ClaudeAI | Post con GIF + datos reales | [ ] |
| 3 | Dev.to | Artículo 1: storytelling | [ ] |
| 4 | LinkedIn | Post: datos reales de uso | [ ] |
| 5 | GitHub | PRs a 5 awesome lists | [ ] |
| 7 | Reddit r/LocalLLaMA | Post versión técnica | [ ] |
| 8 | Dev.to | Artículo 2: evergreen SEO quota guide | [ ] |
| 10 | Reddit r/commandline | Post enfocado en terminal UX | [ ] |
| 12 | LinkedIn | Update: "claudestat got X installs in first week" | [ ] |
| 14 | Dev.to | Artículo 3: data-driven 30 days análisis | [ ] |
| 16 | GitHub Discussions | "Share your claudestat stats" | [ ] |
| 18 | LinkedIn | Post técnico: cómo funciona el hook system | [ ] |
| 21 | Reddit r/ClaudeAI | Update post con nuevas features (roast/share) | [ ] |
| 25 | Dev.to | Artículo 4: "What I learned building an OSS tool in public" | [ ] |
| 28 | LinkedIn | "1 month of claudestat" con métricas reales | [ ] |
| 30 | Reddit | Retrospectiva + roadmap público | [ ] |

---

# Comparación competitiva

| Herramienta | Foco | Diferencia con claudestat |
|-------------|------|--------------------------|
| Langfuse | API observability (server-side) | Requiere integración en código, no es para Claude Code CLI |
| Helicone | API proxy logging | Proxy, no hooks nativas, no Claude Code específico |
| Arize | ML observability enterprise | Enterprise, no developer CLI, diferente caso de uso |
| Scripts caseros | Fragmentados | Sin mantenimiento, sin dashboard, sin kill switch |
| **claudestat** | Claude Code nativo | **Primero en este nicho exacto** |

**Nichos no explotados que puedes capturar:**
- Team/multi-user mode (empresas con varios devs en Claude Code)
- Historical cost export para finanzas/expensing
- Comparison entre sessions de diferentes developers
- "Claude Code observability" como categoría — tú la defines

---

# Métricas de seguimiento

> Revisar semanalmente. Anotar en esta sección.

| Semana | npm downloads | GitHub stars | Artículos | Awesome lists |
|--------|--------------|-------------|-----------|---------------|
| Baseline | | | 0 | 0 |
| Semana 1 | | | | |
| Semana 2 | | | | |
| Semana 3 | | | | |
| Semana 4 | | | | |
| Mes 2 | | | | |
| Mes 3 | | | | |

---

# Notas de sesión

> Añadir aquí notas rápidas durante sesiones de trabajo en el roadmap.

---

*Última actualización: 2026-05-10*

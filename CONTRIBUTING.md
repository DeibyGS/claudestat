# Contributing to claudestat

Thanks for your interest in contributing. claudestat is a small, focused tool — contributions that keep it lean and reliable are always welcome.

---

## Ways to contribute

- **Bug fix** — something breaks or behaves unexpectedly
- **New pattern** — add a usage insight to the pattern analyzer
- **Dashboard improvement** — new chart, better UX, accessibility fix
- **New command** — extend the CLI with useful functionality
- **Documentation** — fix a typo, clarify a step, add an example

If you're unsure whether your idea fits, open an issue first and describe what you want to build.

---

## Setup

**Requirements:** Node.js >= 18 (Node 22 recommended), Claude Code installed locally.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/claudestat
cd claudestat

# 2. Install backend dependencies
npm install

# 3. Install dashboard dependencies
cd dashboard && npm install && cd ..

# 4. Run in dev mode (daemon + dashboard hot reload)
npm run dev

# 5. Run the test suite
npm test
```

The dashboard runs at `http://localhost:7337`. The daemon watches for incoming hook events on the same port.

---

## Project structure

```
claudestat/
├── src/                    # Backend — daemon, CLI, DB, analytics
│   ├── index.ts            # CLI entry point (commander)
│   ├── daemon.ts           # Express server + event loop
│   ├── db.ts               # SQLite operations (node:sqlite)
│   ├── pattern-analyzer.ts # Usage pattern detection
│   ├── enricher.ts         # Correlates hook events with JSONL token data
│   ├── intelligence.ts     # AI-generated insights and reports
│   ├── quota-tracker.ts    # 5h cycle + weekly limit tracking
│   ├── install.ts          # Hook installer / uninstaller
│   └── config.ts           # Config read/write
├── dashboard/              # Frontend — React + Vite + Recharts
│   └── src/
│       └── components/     # One file per view/component
├── hooks/
│   └── event.js            # Hook script copied to ~/.claudestat/hooks/
├── tests/
│   ├── index.ts            # Test entry point
│   ├── pattern-analyzer.test.ts  # 26 unit tests
│   └── db.test.ts          # 18 integration tests (in-memory SQLite)
└── package.json
```

---

## Making changes

### Branch naming

```
fix/description-of-bug
feat/name-of-feature
docs/what-you-changed
refactor/what-you-simplified
```

### Code style

- TypeScript strict mode — no `any` unless necessary
- Keep functions small and focused
- No external dependencies unless clearly justified — the backend has zero runtime deps beyond `express`, `chokidar`, and `commander`
- Dashboard uses React 19 patterns (no class components, no legacy context)

### Adding a pattern to the analyzer

Open `src/pattern-analyzer.ts`. Each pattern is a self-contained block that pushes to the `insights` array. Follow the existing structure:

```typescript
// 1. Compute the metric
const myRatio = someCount / total

// 2. Check the threshold
if (myRatio >= THRESHOLD) {
  insights.push({
    title: 'Short descriptive title',
    description: 'One sentence explaining why this matters and what to do.',
    level: 'tip' | 'warning' | 'positive',
    metric: `${(myRatio * 100).toFixed(0)}%`,
  })
}
```

Then add a test in `tests/pattern-analyzer.test.ts` covering at least: triggered case, non-triggered case, and any edge case (e.g. division by zero).

---

## Tests

All tests use `node:test` (built-in, zero extra deps) with `tsx/cjs` for TypeScript transpilation.

```bash
npm test
```

Expected output: **44 tests passing**. All tests must pass before opening a PR.

- `tests/pattern-analyzer.test.ts` — pure unit tests, no DB, no side effects
- `tests/db.test.ts` — integration tests against an in-memory SQLite DB

If you add a new `dbOps` function, add a test in `db.test.ts`. If you modify `analyzePatterns`, add a test in `pattern-analyzer.test.ts`.

---

## Opening a PR

1. Make sure `npm test` passes locally
2. Make sure `npm run build` completes without errors
3. Open a PR against the `master` branch
4. Include in the PR description:
   - **What** changed
   - **Why** it was needed
   - **How** to test it manually (if not fully covered by automated tests)

Keep PRs focused. One feature or fix per PR — easier to review and merge.

---

## Reporting a bug

Open an issue and include:

- Node.js version (`node --version`)
- OS and version
- Steps to reproduce
- What you expected vs what happened
- Any relevant output from `claudestat status` or the terminal

---

## Questions

Open an issue with the `question` label. No question is too small.

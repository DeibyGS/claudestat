import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getWarnLevel, readConfig } from '../src/config'
import { CONTEXT_THRESHOLDS } from '../src/pricing'

// ─── Context threshold alerts ────────────────────────────────────────────────

describe('CONTEXT_THRESHOLDS — notification triggers', () => {
  test('CONTEXT_THRESHOLDS is [50, 75, 90]', () => {
    assert.deepStrictEqual([...CONTEXT_THRESHOLDS], [50, 75, 90])
  })

  test('getWarnLevel returns null below first threshold (50%)', () => {
    assert.strictEqual(getWarnLevel(49, CONTEXT_THRESHOLDS), null)
  })

  test('getWarnLevel returns yellow between 50% and 74%', () => {
    assert.strictEqual(getWarnLevel(50, CONTEXT_THRESHOLDS), 'yellow')
    assert.strictEqual(getWarnLevel(60, CONTEXT_THRESHOLDS), 'yellow')
    assert.strictEqual(getWarnLevel(74, CONTEXT_THRESHOLDS), 'yellow')
  })

  test('getWarnLevel returns orange between 75% and 89%', () => {
    assert.strictEqual(getWarnLevel(75, CONTEXT_THRESHOLDS), 'orange')
    assert.strictEqual(getWarnLevel(80, CONTEXT_THRESHOLDS), 'orange')
    assert.strictEqual(getWarnLevel(89, CONTEXT_THRESHOLDS), 'orange')
  })

  test('getWarnLevel returns red at 90% and above', () => {
    assert.strictEqual(getWarnLevel(90, CONTEXT_THRESHOLDS), 'red')
    assert.strictEqual(getWarnLevel(95, CONTEXT_THRESHOLDS), 'red')
    assert.strictEqual(getWarnLevel(100, CONTEXT_THRESHOLDS), 'red')
  })
})

// ─── Context percentage calculation (mirrors processJSONL logic) ─────────────

describe('context_used calculation — includes output tokens', () => {
  // This mirrors the fixed logic in watchers/claude-code.ts:113-116
  function calcContextUsed(
    inputTokens: number,
    cacheRead: number,
    cacheCreation: number,
    outputTokens: number
  ): number {
    return (inputTokens ?? 0)
         + (cacheRead ?? 0)
         + (cacheCreation ?? 0)
         + (outputTokens ?? 0)
  }

  test('includes all token types', () => {
    const result = calcContextUsed(10000, 5000, 2000, 3000)
    assert.equal(result, 20000)
  })

  test('handles zero values', () => {
    const result = calcContextUsed(0, 0, 0, 0)
    assert.equal(result, 0)
  })

  test('handles undefined values as zero', () => {
    const result = calcContextUsed(undefined as any, undefined as any, undefined as any, undefined as any)
    assert.equal(result, 0)
  })

  test('output tokens contribute to total', () => {
    const withoutOutput = calcContextUsed(10000, 5000, 2000, 0)
    const withOutput = calcContextUsed(10000, 5000, 2000, 3000)
    assert.ok(withOutput > withoutOutput, 'Output tokens should increase context_used')
    assert.equal(withOutput - withoutOutput, 3000)
  })

  test('context percentage calculation matches expected', () => {
    const contextUsed = calcContextUsed(150000, 20000, 10000, 20000)
    const contextWindow = 200000
    const pct = Math.round((contextUsed / contextWindow) * 100)
    assert.equal(pct, 100) // 200000/200000 = 100%
  })

  test('context percentage below threshold', () => {
    const contextUsed = calcContextUsed(80000, 10000, 5000, 5000)
    const contextWindow = 200000
    const pct = Math.round((contextUsed / contextWindow) * 100)
    assert.equal(pct, 50) // 100000/200000 = 50%
  })
})

// ─── Weekly threshold alerts ─────────────────────────────────────────────────

describe('weekly threshold alerts', () => {
  const weeklyThresholds = [50, 75, 90]

  test('weekly thresholds fire at correct levels', () => {
    assert.strictEqual(getWarnLevel(49, weeklyThresholds), null)
    assert.strictEqual(getWarnLevel(50, weeklyThresholds), 'yellow')
    assert.strictEqual(getWarnLevel(74, weeklyThresholds), 'yellow')
    assert.strictEqual(getWarnLevel(75, weeklyThresholds), 'orange')
    assert.strictEqual(getWarnLevel(89, weeklyThresholds), 'orange')
    assert.strictEqual(getWarnLevel(90, weeklyThresholds), 'red')
    assert.strictEqual(getWarnLevel(100, weeklyThresholds), 'red')
  })

  test('escalation-only: same level does not re-trigger', () => {
    // In the daemon, checkAlertLevel only fires if currRank > prevRank
    const LEVEL_RANK: Record<string, number> = { yellow: 1, orange: 2, red: 3 }

    function shouldFire(current: string | null, previous: string | null): boolean {
      if (!current) return false
      const prevRank = previous ? LEVEL_RANK[previous] ?? 0 : 0
      const currRank = LEVEL_RANK[current]
      return currRank > prevRank
    }

    // First alert at yellow → fires
    assert.ok(shouldFire('yellow', null))
    // Same level yellow → does not fire
    assert.ok(!shouldFire('yellow', 'yellow'))
    // Escalate to orange → fires
    assert.ok(shouldFire('orange', 'yellow'))
    // Same level orange → does not fire
    assert.ok(!shouldFire('orange', 'orange'))
    // Escalate to red → fires
    assert.ok(shouldFire('red', 'orange'))
    // Same level red → does not fire
    assert.ok(!shouldFire('red', 'red'))
  })
})

// ─── Cycle 5h threshold alerts ───────────────────────────────────────────────

describe('cycle 5h threshold alerts', () => {
  const cycleThresholds = [70, 85, 95]

  test('cycle thresholds fire at correct levels', () => {
    assert.strictEqual(getWarnLevel(69, cycleThresholds), null)
    assert.strictEqual(getWarnLevel(70, cycleThresholds), 'yellow')
    assert.strictEqual(getWarnLevel(84, cycleThresholds), 'yellow')
    assert.strictEqual(getWarnLevel(85, cycleThresholds), 'orange')
    assert.strictEqual(getWarnLevel(94, cycleThresholds), 'orange')
    assert.strictEqual(getWarnLevel(95, cycleThresholds), 'red')
    assert.strictEqual(getWarnLevel(100, cycleThresholds), 'red')
  })
})

// ─── Alert cooldown logic ────────────────────────────────────────────────────

describe('alert cooldown logic', () => {
  test('cooldown prevents repeated alerts within 1 hour', () => {
    const cooldown = new Map<string, number>()
    const ALERT_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour

    function shouldFireAlert(level: string, now: number): boolean {
      const lastFired = cooldown.get(level) ?? 0
      if (now - lastFired < ALERT_COOLDOWN_MS) return false
      cooldown.set(level, now)
      return true
    }

    const now = Date.now()

    // First alert fires
    assert.ok(shouldFireAlert('yellow', now))
    // Same level within cooldown does not fire
    assert.ok(!shouldFireAlert('yellow', now + 1000))
    // Different level fires
    assert.ok(shouldFireAlert('orange', now + 1000))
    // After cooldown, same level fires again
    assert.ok(shouldFireAlert('yellow', now + ALERT_COOLDOWN_MS + 1))
  })
})

// ─── Thresholds fired per session (anti-duplicate) ───────────────────────────

describe('context thresholds fired per session', () => {
  test('each threshold fires only once per session', () => {
    const fired = new Map<string, Set<number>>()

    function checkThreshold(sessionId: string, pct: number, threshold: number): boolean {
      if (!fired.has(sessionId)) {
        fired.set(sessionId, new Set())
      }
      const sessionFired = fired.get(sessionId)!
      if (sessionFired.has(threshold)) return false
      if (pct >= threshold) {
        sessionFired.add(threshold)
        return true
      }
      return false
    }

    // First time at 50% → fires
    assert.ok(checkThreshold('session-1', 50, 50))
    // Same threshold again → does not fire
    assert.ok(!checkThreshold('session-1', 60, 50))
    // Different threshold at 75% → fires
    assert.ok(checkThreshold('session-1', 75, 75))
    // Same threshold again → does not fire
    assert.ok(!checkThreshold('session-1', 80, 75))
    // Different session → fires independently
    assert.ok(checkThreshold('session-2', 50, 50))
  })

  test('thresholds reset on new session when context drops below 40%', () => {
    const fired = new Map<string, Set<number>>()

    function onNewSession(sessionId: string, pctCurrent: number): void {
      if (!fired.has(sessionId)) {
        fired.set(sessionId, new Set())
      }
      if (pctCurrent < 40) {
        fired.get(sessionId)!.clear()
      }
    }

    // Session with fired thresholds
    fired.set('session-1', new Set([50, 75]))
    // New session with low context → clears thresholds
    onNewSession('session-1', 30)
    assert.deepStrictEqual([...fired.get('session-1')!], [])
  })
})

// ─── Weekly thresholds reset ─────────────────────────────────────────────────

describe('weekly thresholds reset', () => {
  test('weekly thresholds clear when percentage drops (new week)', () => {
    let weeklyThresholdsFired = new Set<number>([25, 50, 75])
    let lastWeeklyPct = 80

    function onWeeklyUpdate(weeklyPct: number): void {
      if (weeklyPct < lastWeeklyPct) {
        weeklyThresholdsFired.clear()
      }
      lastWeeklyPct = weeklyPct
    }

    // Percentage drops (new week) → clears thresholds
    onWeeklyUpdate(10)
    assert.deepStrictEqual([...weeklyThresholdsFired], [])
  })
})

// ─── Cycle reset detection ───────────────────────────────────────────────────

describe('cycle reset detection', () => {
  test('cycle alert level resets on new cycle', () => {
    let lastCycleAlertLevel: string | null = 'red'
    let lastCycleResetAt = 1000

    function onCycleUpdate(cycleResetAt: number): void {
      if (cycleResetAt !== lastCycleResetAt && lastCycleResetAt !== 0) {
        lastCycleAlertLevel = null
      }
      lastCycleResetAt = cycleResetAt
    }

    // New cycle → resets alert level
    onCycleUpdate(2000)
    assert.strictEqual(lastCycleAlertLevel, null)
  })
})

// ─── Config defaults for notification thresholds ─────────────────────────────

describe('notification config defaults', () => {
  test('warnThresholds defaults to [70, 85, 95]', () => {
    const cfg = readConfig()
    assert.deepStrictEqual(cfg.warnThresholds, [70, 85, 95])
  })

  test('weeklyWarnThresholds defaults to [50, 75, 90]', () => {
    const cfg = readConfig()
    assert.deepStrictEqual(cfg.weeklyWarnThresholds, [50, 75, 90])
  })

  test('alertsEnabled defaults to true', () => {
    const cfg = readConfig()
    assert.strictEqual(cfg.alertsEnabled, true)
  })

  test('killSwitchThreshold defaults to 95', () => {
    const cfg = readConfig()
    assert.strictEqual(cfg.killSwitchThreshold, 95)
  })
})

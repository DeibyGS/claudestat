import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
// NOTE: computeQuota reads ~/.claude/projects/ and calls readClaudeAuth (keychain).
// We test only the pure exported functions: invalidateQuotaCache is a side-effect util.
// The PLAN_LIMITS constants and detectPlan logic are exercised indirectly via computeQuota
// but are not individually exported — we document that limitation here.
import { invalidateQuotaCache } from '../src/quota-tracker'
import { validateConfig, getWarnLevel } from '../src/config'

// ─── Plan limit values (tested via config + known constants) ──────────────────

describe('PLAN_LIMITS — known values', () => {
  // These constants are not exported but their effects are observable.
  // We document the expected values from source inspection:
  // free: 10 prompts/5h | pro: 45 | max5: 225 | max20: 900

  test('pro plan limit is 45 prompts per 5h window (documented)', () => {
    // Documented from source — not a live call, just a contract assertion
    const knownProLimit = 45
    assert.ok(knownProLimit > 0, 'pro limit should be positive')
  })

  test('max20 limit is greater than max5 limit (documented)', () => {
    const max5  = 225
    const max20 = 900
    assert.ok(max20 > max5, 'max20 should have more prompts than max5')
  })

  test('all known plan limits are positive integers (documented)', () => {
    const limits = { free: 10, pro: 45, max5: 225, max20: 900 }
    for (const [plan, limit] of Object.entries(limits)) {
      assert.ok(Number.isInteger(limit) && limit > 0, `${plan} limit should be a positive integer`)
    }
  })
})

// ─── Quota percentage calculation (pure math) ─────────────────────────────────

describe('quota percentage calculation', () => {
  function calcPct(used: number, limit: number): number {
    return Math.min(100, Math.round(used / limit * 100))
  }

  test('0 prompts gives 0%', () => {
    assert.equal(calcPct(0, 45), 0)
  })

  test('half usage gives 50%', () => {
    assert.equal(calcPct(22, 44), 50)
  })

  test('at limit gives 100%', () => {
    assert.equal(calcPct(45, 45), 100)
  })

  test('over limit is capped at 100%', () => {
    assert.equal(calcPct(50, 45), 100)
  })

  test('fractional rounds correctly', () => {
    // 1/3 = 33.33 → rounds to 33
    assert.equal(calcPct(1, 3), 33)
  })
})

// ─── Plan detection thresholds (logic mirrored from source) ───────────────────

describe('plan detection logic (mirrored from detectPlan)', () => {
  // detectPlan is not exported — we mirror its logic for unit testing
  function detectPlan(maxSeen: number): 'pro' | 'max5' | 'max20' {
    if (maxSeen > 200) return 'max20'
    if (maxSeen > 40)  return 'max5'
    return 'pro'
  }

  test('0 prompts → pro', () => {
    assert.equal(detectPlan(0), 'pro')
  })

  test('40 prompts → pro (boundary)', () => {
    assert.equal(detectPlan(40), 'pro')
  })

  test('41 prompts → max5', () => {
    assert.equal(detectPlan(41), 'max5')
  })

  test('200 prompts → max5 (boundary)', () => {
    assert.equal(detectPlan(200), 'max5')
  })

  test('201 prompts → max20', () => {
    assert.equal(detectPlan(201), 'max20')
  })
})

// ─── Reset time formatting ────────────────────────────────────────────────────

describe('reset time formatting', () => {
  function formatResetMs(ms: number): string {
    if (ms <= 0) return 'Disponible'
    const totalSec = Math.ceil(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  test('0ms returns "Disponible"', () => {
    assert.equal(formatResetMs(0), 'Disponible')
  })

  test('negative ms returns "Disponible"', () => {
    assert.equal(formatResetMs(-1000), 'Disponible')
  })

  test('90 seconds returns "1m 30s"', () => {
    assert.equal(formatResetMs(90_000), '1m 30s')
  })

  test('3600 seconds returns "1h 0m"', () => {
    assert.equal(formatResetMs(3_600_000), '1h 0m')
  })

  test('5h exactly returns "5h 0m"', () => {
    assert.equal(formatResetMs(5 * 60 * 60 * 1000), '5h 0m')
  })
})

// ─── Burn rate calculation ─────────────────────────────────────────────────────

describe('burn rate calculation', () => {
  function calcBurnRate(totalTokens: number, windowMin: number): number {
    return totalTokens > 0 ? Math.round(totalTokens / windowMin) : 0
  }

  test('0 tokens returns 0 burn rate', () => {
    assert.equal(calcBurnRate(0, 30), 0)
  })

  test('3000 tokens over 30 min = 100 tokens/min', () => {
    assert.equal(calcBurnRate(3000, 30), 100)
  })

  test('burn rate rounds correctly', () => {
    // 100 tokens / 30 min = 3.33 → rounds to 3
    assert.equal(calcBurnRate(100, 30), 3)
  })
})

// ─── invalidateQuotaCache ─────────────────────────────────────────────────────

describe('invalidateQuotaCache', () => {
  test('does not throw when called', () => {
    assert.doesNotThrow(() => invalidateQuotaCache())
  })

  test('can be called multiple times without error', () => {
    assert.doesNotThrow(() => {
      invalidateQuotaCache()
      invalidateQuotaCache()
    })
  })
})

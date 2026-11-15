import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { refreshFromApi, computeQuota, invalidateQuotaCache, exceedsPromptLimit } from '../src/quota-tracker'
import { subscriptionTypeToPlan } from '../src/claude-auth'

// refreshFromApi() se integra con el keychain y la red — en entorno de test
// no hay token disponible, así que debe terminar silenciosamente sin lanzar.

describe('refreshFromApi — sin credenciales (entorno de test)', () => {
  test('resuelve sin lanzar cuando no hay token OAuth', async () => {
    await assert.doesNotReject(() => refreshFromApi())
  })

  test('puede llamarse múltiples veces sin error', async () => {
    await assert.doesNotReject(async () => {
      await refreshFromApi()
      await refreshFromApi()
    })
  })
})

describe('computeQuota — integración con apiCache', () => {
  test('devuelve QuotaData válido con o sin apiCache', () => {
    invalidateQuotaCache()
    const q = computeQuota()
    assert.ok(typeof q.cyclePct === 'number',      'cyclePct debe ser number')
    assert.ok(typeof q.weeklyPctAll === 'number',  'weeklyPctAll debe ser number')
    assert.ok(typeof q.cycleResetMs === 'number',  'cycleResetMs debe ser number')
    assert.ok(q.cyclePct >= 0 && q.cyclePct <= 100,     'cyclePct en rango [0,100]')
    assert.ok(q.weeklyPctAll >= 0 && q.weeklyPctAll <= 100, 'weeklyPctAll en rango [0,100]')
    assert.ok(q.cycleResetMs >= 0,                 'cycleResetMs no negativo')
  })

  test('campos de JSONL siguen presentes independiente del apiCache', () => {
    invalidateQuotaCache()
    const q = computeQuota()
    assert.ok(typeof q.burnRateTokensPerMin === 'number', 'burnRate presente')
    assert.ok(typeof q.weeklyHoursSonnet === 'number',    'weeklyHoursSonnet presente')
    assert.ok(typeof q.cyclePrompts === 'number',         'cyclePrompts presente')
    assert.ok(typeof q.detectedPlan === 'string',         'detectedPlan presente')
  })
})

// ─── S8: Team / Enterprise plans ─────────────────────────────────────────────

describe('S8 plan detection — Team / Enterprise', () => {
  test('subscriptionType team/enterprise maps to its own plan, even with a max rate tier', () => {
    assert.equal(subscriptionTypeToPlan('team', 'default_claude_max_5x'), 'team')
    assert.equal(subscriptionTypeToPlan('enterprise', 'unknown'), 'enterprise')
    assert.equal(subscriptionTypeToPlan('max', 'default_claude_max_20x'), 'max20')  // regression: unchanged
  })

  test('team/enterprise have no invented local limits: % comes only from the API', () => {
    for (const plan of ['team', 'enterprise'] as const) {
      invalidateQuotaCache()
      const q = computeQuota(plan)
      assert.equal(q.detectedPlan, plan)
      assert.equal(q.cycleLimitTokens, 0)
      assert.equal(q.weeklyLimitSonnet, 0)
      assert.ok(Number.isFinite(q.cyclePct) && q.cyclePct >= 0 && q.cyclePct <= 100, String(q.cyclePct))
    }
  })
})

describe('S8 — plans without a local prompt limit', () => {
  test('a 0 limit (team/enterprise) is never "over limit"', () => {
    assert.equal(exceedsPromptLimit(5, 0), false)
    assert.equal(exceedsPromptLimit(46, 45), true)   // regression: pro still flags
  })

  test('team and enterprise can be forced from config', () => {
    const { validateConfig } = require('../src/config')
    assert.equal(validateConfig({ plan: 'team' }), null)
    assert.equal(validateConfig({ plan: 'enterprise' }), null)
  })
})

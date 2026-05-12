import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { refreshFromApi, computeQuota, invalidateQuotaCache } from '../src/quota-tracker'

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

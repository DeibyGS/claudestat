import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  PRICING, DEFAULT_PRICING, pricingFor, calcCost, estimateCost,
  KNOWN_CONTEXT_WINDOWS, findPricing,
} from '../src/model-pricing'
import { getContextWindow } from '../src/pricing'

describe('model-pricing — official Anthropic prices', () => {
  test('current models have exact official prices', () => {
    assert.deepEqual(PRICING['claude-opus-5-5'],   { input: 4,    output: 20, cacheRead: 0.20, cacheCreate: 5.00 })
    assert.deepEqual(PRICING['claude-sonnet-5'],   { input: 2,    output: 10, cacheRead: 0.20, cacheCreate: 2.50  })
    assert.deepEqual(PRICING['claude-opus-4-6'],   { input: 5,    output: 25, cacheRead: 0.50, cacheCreate: 6.25  })
    assert.deepEqual(PRICING['claude-sonnet-4-6'], { input: 3,    output: 15, cacheRead: 0.30, cacheCreate: 3.75  })
    assert.deepEqual(PRICING['claude-haiku-4-5'],  { input: 1,    output: 5,  cacheRead: 0.10, cacheCreate: 1.25  })
  })

  test('pricingFor resolves exact, dated, family and default', () => {
    assert.equal(pricingFor('claude-opus-5-5'), PRICING['claude-opus-5-5'])
    assert.equal(pricingFor('claude-sonnet-4-6-20250514').input, 3)
    // Unknown opus version must bill at opus prices, not Sonnet fallback
    assert.equal(pricingFor('claude-opus-9-9'), PRICING['claude-opus-5-5'])
    assert.equal(pricingFor('sonnet').output, 10)
    assert.equal(pricingFor('haiku').input, 1)
    assert.equal(pricingFor('mimo-v2.6-flash-free'), DEFAULT_PRICING)
    assert.equal(pricingFor(undefined), DEFAULT_PRICING)
    assert.equal(pricingFor(null), DEFAULT_PRICING)
  })

  test('calcCost / estimateCost use resolved pricing', () => {
    const usage = {
      input_tokens: 1_000_000, output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000,
    }
    assert.equal(calcCost('claude-opus-5-5', usage), 4 + 20 + 0.20 + 5)
    assert.equal(estimateCost(1_000_000, 1_000_000, 'claude-sonnet-5'), 2 + 10)
  })

  test('context windows: 967K auto-compact window for 5.x models', () => {
    assert.equal(KNOWN_CONTEXT_WINDOWS['claude-opus-5-5'], 967_000)
    assert.equal(KNOWN_CONTEXT_WINDOWS['claude-sonnet-5'], 967_000)
    assert.equal(getContextWindow('claude-opus-4-6'), 200_000)
    assert.equal(getContextWindow('unknown-model'), 200_000)
  })

  test('findPricing recognizes new model IDs', () => {
    assert.deepEqual(findPricing('claude-opus-5-5'), { input: 4, output: 20 })
    assert.equal(findPricing('gpt-4o'), null)
  })
})

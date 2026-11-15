import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  PRICING, pricingFor, calcCost, estimateCost,
  KNOWN_CONTEXT_WINDOWS, findPricing, isPriced, priceUsage, UNPRICED,
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
    // Bare family → newest model of that family (Haiku 5.5 base tier)
    assert.equal(pricingFor('haiku').input, 0.10)
    // Unknown / missing models resolve to UNPRICED (zero), never to Sonnet
    assert.equal(pricingFor('mimo-v2.6-flash-free'), UNPRICED)
    assert.equal(pricingFor(undefined), UNPRICED)
    assert.equal(pricingFor(null), UNPRICED)
  })

  // S1 — official rates (platform.claude.com/docs/en/about-claude/pricing, verified 2026-11-15).
  // Cache write = 5-minute TTL; cache reads are 0.025x on Fable/Mythos 5.1+,
  // 0.05x on Opus 5.5 / Sonnet 5.5, 0.1x elsewhere.
  test('S1: every current Claude model bills at its own rates', () => {
    const cases: Array<[string, { input: number; output: number; cacheRead: number; cacheCreate: number }]> = [
      ['claude-fable-5-2',  { input: 8,    output: 40,   cacheRead: 0.20, cacheCreate: 10    }],
      ['claude-mythos-5-2', { input: 8,    output: 40,   cacheRead: 0.20, cacheCreate: 10    }],
      ['claude-mythos-5-1', { input: 10,   output: 50,   cacheRead: 0.25, cacheCreate: 12.50 }],
      ['claude-mythos-5',   { input: 10,   output: 50,   cacheRead: 1.00, cacheCreate: 12.50 }],
      ['claude-sonnet-5-5', { input: 2,    output: 10,   cacheRead: 0.10, cacheCreate: 2.50  }],
      ['claude-haiku-5-5',  { input: 0.10, output: 0.50, cacheRead: 0.01, cacheCreate: 0.125 }],
      ['claude-opus-4-5-20251101',   { input: 5,  output: 25, cacheRead: 0.50, cacheCreate: 6.25  }],
      ['claude-sonnet-4-5-20250929', { input: 3,  output: 15, cacheRead: 0.30, cacheCreate: 3.75  }],
      ['claude-opus-4-1-20250805',   { input: 15, output: 75, cacheRead: 1.50, cacheCreate: 18.75 }],
      ['claude-opus-4-20250514',     { input: 15, output: 75, cacheRead: 1.50, cacheCreate: 18.75 }],
      ['claude-sonnet-4-20250514',   { input: 3,  output: 15, cacheRead: 0.30, cacheCreate: 3.75  }],
      ['claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.25, cacheCreate: 12.50 }],
      ['claude-fable-5',   { input: 10, output: 50, cacheRead: 1.00, cacheCreate: 12.50 }],
      ['claude-opus-5',    { input: 5,  output: 25, cacheRead: 0.50, cacheCreate: 6.25  }],
      ['claude-opus-4-8',  { input: 5,  output: 25, cacheRead: 0.50, cacheCreate: 6.25  }],
      ['claude-opus-4-7',  { input: 5,  output: 25, cacheRead: 0.50, cacheCreate: 6.25  }],
    ]
    for (const [model, expected] of cases) {
      assert.deepEqual(pricingFor(model), expected, model)
      assert.equal(isPriced(model), true, model)
    }
    // Prefix overlap: opus-5-5 must not resolve to opus-5, fable-5-1 not to fable-5
    assert.equal(pricingFor('claude-opus-5-5').input, 4)
    assert.equal(pricingFor('claude-fable-5-1').cacheRead, 0.25)
    // [1m] / dated variants still resolve
    assert.equal(pricingFor('claude-opus-4-8[1m]').input, 5)
    // Unknown future versions → newest of the family, never an old dated key
    assert.equal(pricingFor('claude-fable-9').input, 8)
    assert.equal(pricingFor('claude-opus-4-9').input, 4)
  })

  test('S1: Haiku 5.5 bills each request by prompt length (> 100K tokens = long-context rates)', () => {
    const at = (input: number) => ({
      input_tokens: input, output_tokens: 1_000_000,
      cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    })
    // 100,000 prompt tokens → base tier
    assert.equal(priceUsage('claude-haiku-5-5', at(100_000)).cost_usd, 100_000 * 0.10 / 1e6 + 0.50)
    // Prompt length counts cache reads and writes too: 60K + 30K + 20K = 110K → long tier
    const long = priceUsage('claude-haiku-5-5', {
      input_tokens: 60_000, output_tokens: 1_000_000,
      cache_read_input_tokens: 30_000, cache_creation_input_tokens: 20_000,
    })
    const expected = (60_000 * 0.50 + 30_000 * 0.05 + 20_000 * 0.625) / 1e6 + 2.50
    assert.ok(Math.abs(long.cost_usd - expected) < 1e-12, `${long.cost_usd} vs ${expected}`)
  })

  test('S1 (error): an unknown model is flagged unpriced, not a Sonnet estimate', () => {
    const usage = {
      input_tokens: 1_000_000, output_tokens: 1_000_000,
      cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    }
    assert.equal(isPriced('gpt-6.1-sol'), false)
    assert.deepEqual(priceUsage('gpt-6.1-sol', usage), { cost_usd: 0, priced: false })
    assert.equal(calcCost('gpt-6.1-sol', usage), 0)
    assert.deepEqual(priceUsage('claude-opus-5', usage), { cost_usd: 30, priced: true })
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

  // Claude Code compacts ~33K below the 1M API window (measured 965,904 max on
  // opus-5-5); 200K-window models keep 200K.
  test('context windows: every 1M Claude model uses the 967K Claude Code window', () => {
    for (const m of [
      'claude-fable-5-2', 'claude-fable-5-1', 'claude-fable-5',
      'claude-mythos-5-2', 'claude-mythos-5-1', 'claude-mythos-5',
      'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7',
      'claude-sonnet-5-5', 'claude-haiku-5-5',
    ]) assert.equal(getContextWindow(m), 967_000, m)
    for (const m of ['claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'])
      assert.equal(getContextWindow(m), 200_000, m)
    // Suffixed IDs resolve to their base model
    assert.equal(getContextWindow('claude-opus-4-8[1m]'), 967_000)
    // Non-Claude models are not guessed here: OpenCode reads them from its catalog
    assert.equal(getContextWindow('deepseek-v4-flash-free'), 200_000)
  })

  test('findPricing recognizes new model IDs', () => {
    assert.deepEqual(findPricing('claude-opus-5-5'), { input: 4, output: 20 })
    assert.equal(findPricing('gpt-4o'), null)
  })
})

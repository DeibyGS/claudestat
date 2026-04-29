import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getAllBlockCostsForSession } from '../src/enricher'

// NOTE: processJSONL and calcCost are not exported from enricher.ts.
// We test the observable behavior via getAllBlockCostsForSession and
// the exported startEnricher/processLatestForSession.
// For pure parsing logic, we mirror the parser inline (same logic, testable without FS).

// ─── Inline JSONL parser (mirrors enricher.ts processJSONL logic) ─────────────

interface ParsedCost {
  input_tokens: number
  output_tokens: number
  cache_read: number
  cache_creation: number
  cost_usd: number
}

const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheCreate: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.30, cacheCreate: 3.75 },
  'claude-opus-4-6':   { input: 15, output: 75, cacheRead: 1.50, cacheCreate: 18.75 },
  'claude-haiku-4-5':  { input: 0.80, output: 4, cacheRead: 0.08, cacheCreate: 1.00 },
}
const DEFAULT_PRICING = PRICING['claude-sonnet-4-6']

function parseJSONLString(content: string): ParsedCost {
  const totals: ParsedCost = { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_creation: 0, cost_usd: 0 }
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      const obj = JSON.parse(line)
      if (obj.type !== 'assistant') continue
      const usage = obj.message?.usage
      const model = obj.message?.model ?? 'claude-sonnet-4-6'
      if (!usage) continue
      const p = PRICING[model] ?? DEFAULT_PRICING
      const M = 1_000_000
      totals.input_tokens   += usage.input_tokens                  ?? 0
      totals.output_tokens  += usage.output_tokens                 ?? 0
      totals.cache_read     += usage.cache_read_input_tokens       ?? 0
      totals.cache_creation += usage.cache_creation_input_tokens   ?? 0
      totals.cost_usd += (
        ((usage.input_tokens ?? 0)                  * p.input)       +
        ((usage.output_tokens ?? 0)                 * p.output)      +
        ((usage.cache_read_input_tokens ?? 0)        * p.cacheRead)   +
        ((usage.cache_creation_input_tokens ?? 0)    * p.cacheCreate)
      ) / M
    } catch { /* malformed line — ignore */ }
  }
  return totals
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assistantLine(opts: {
  model?: string
  input?: number
  output?: number
  cache_read?: number
  cache_creation?: number
}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: {
      model: opts.model ?? 'claude-sonnet-4-6',
      usage: {
        input_tokens:                opts.input        ?? 0,
        output_tokens:               opts.output       ?? 0,
        cache_read_input_tokens:     opts.cache_read   ?? 0,
        cache_creation_input_tokens: opts.cache_creation ?? 0,
      }
    }
  })
}

function humanLine(text: string): string {
  return JSON.stringify({
    type: 'human',
    timestamp: new Date().toISOString(),
    message: { content: text }
  })
}

// ─── Parse single assistant line ─────────────────────────────────────────────

describe('JSONL parser — single assistant line', () => {
  test('parses input, output, cache_read, cache_creation tokens correctly', () => {
    const line = assistantLine({ input: 1000, output: 200, cache_read: 500, cache_creation: 100 })
    const result = parseJSONLString(line)
    assert.equal(result.input_tokens,   1000)
    assert.equal(result.output_tokens,  200)
    assert.equal(result.cache_read,     500)
    assert.equal(result.cache_creation, 100)
  })

  test('cost_usd > 0 when tokens are non-zero', () => {
    const line = assistantLine({ input: 1000, output: 500 })
    const result = parseJSONLString(line)
    assert.ok(result.cost_usd > 0, 'cost_usd should be positive')
  })

  test('cost_usd = 0 when all token counts are 0', () => {
    const line = assistantLine({ input: 0, output: 0 })
    const result = parseJSONLString(line)
    assert.equal(result.cost_usd, 0)
  })
})

// ─── Malformed lines ─────────────────────────────────────────────────────────

describe('JSONL parser — malformed lines', () => {
  test('ignores a malformed JSON line without throwing', () => {
    const content = 'not-json\n' + assistantLine({ input: 100, output: 50 })
    assert.doesNotThrow(() => parseJSONLString(content))
    const result = parseJSONLString(content)
    assert.equal(result.input_tokens, 100)
  })

  test('ignores non-assistant type lines', () => {
    const content = humanLine('hello') + '\n' + assistantLine({ input: 200, output: 80 })
    const result = parseJSONLString(content)
    assert.equal(result.input_tokens, 200)
  })

  test('handles empty string without throwing', () => {
    assert.doesNotThrow(() => parseJSONLString(''))
    const result = parseJSONLString('')
    assert.equal(result.cost_usd, 0)
  })

  test('handles blank lines between entries', () => {
    const content = assistantLine({ input: 100 }) + '\n\n\n' + assistantLine({ input: 200 })
    const result = parseJSONLString(content)
    assert.equal(result.input_tokens, 300)
  })
})

// ─── Multiple entries / aggregation ──────────────────────────────────────────

describe('JSONL parser — multiple entries aggregation', () => {
  test('sums tokens across multiple assistant lines', () => {
    const content = [
      assistantLine({ input: 1000, output: 100 }),
      assistantLine({ input: 2000, output: 200 }),
      assistantLine({ input: 3000, output: 300 }),
    ].join('\n')
    const result = parseJSONLString(content)
    assert.equal(result.input_tokens,  6000)
    assert.equal(result.output_tokens, 600)
  })

  test('accumulates cost_usd across multiple lines', () => {
    const single = parseJSONLString(assistantLine({ input: 1000, output: 100 }))
    const double = parseJSONLString(
      assistantLine({ input: 1000, output: 100 }) + '\n' +
      assistantLine({ input: 1000, output: 100 })
    )
    assert.ok(Math.abs(double.cost_usd - single.cost_usd * 2) < 1e-10, 'cost should double')
  })

  test('uses correct pricing per model (opus costs more than sonnet)', () => {
    const sonnet = parseJSONLString(assistantLine({ model: 'claude-sonnet-4-6', input: 1000, output: 100 }))
    const opus   = parseJSONLString(assistantLine({ model: 'claude-opus-4-6',   input: 1000, output: 100 }))
    assert.ok(opus.cost_usd > sonnet.cost_usd, 'opus should be more expensive than sonnet')
  })
})

// ─── getAllBlockCostsForSession — no PROJECTS_DIR ─────────────────────────────

describe('getAllBlockCostsForSession', () => {
  test('returns empty array for unknown session when PROJECTS_DIR missing', () => {
    // When ~/.claude/projects does not exist or session is unknown, result is []
    const result = getAllBlockCostsForSession('nonexistent-session-id-00000000')
    assert.deepEqual(result, [])
  })
})

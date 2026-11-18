import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { MetricCards, type SessionTurns } from '../dashboard/src/components/LiveMetricCards'

const dashboardRequire = createRequire(`${__dirname}/../dashboard/package.json`)
const { createElement } = dashboardRequire('react')
const { renderToStaticMarkup } = dashboardRequire('react-dom/server')

const data: SessionTurns = {
  turns: [
    { ts: 1, cost_usd: 0.01, priced: true },
    { ts: 2, cost_usd: null, priced: false },
    { ts: 3, cost_usd: 0, priced: true },
  ],
  totals: {
    lines_added: 12, lines_removed: 3, api_ms: 2000, tool_ms: 6000,
    thinking_tokens_est: 42,
    compactions: [{ ts: 20, pre_tokens: 9000 }, { ts: 10, pre_tokens: 5000 }],
  },
}

test('S12 renders session metrics, latest compaction and per-turn costs with gaps for unpriced turns', () => {
  const html = renderToStaticMarkup(createElement(MetricCards, { data }))
  for (const value of ['+12', '−3', '2.0s', '6.0s', '25%', '≈42', '9,000', '$0.0000']) {
    assert.ok(html.includes(value), `missing ${value}`)
  }
  assert.ok(html.includes('1 unpriced'))
  assert.ok(html.includes('Turn 2: —'))
  assert.equal((html.match(/<circle /g) ?? []).length, 2)
  assert.ok(!html.includes('<polyline'))
})

test('S12 keeps unavailable metrics distinct from known zeros and never invents cost', () => {
  const empty = renderToStaticMarkup(createElement(MetricCards, {}))
  assert.ok(!empty.includes('$0.0000'))
  assert.ok(!empty.includes('≈0'))
  const html = renderToStaticMarkup(createElement(MetricCards, {
    data: { turns: [{ ts: 1, cost_usd: 99, priced: false }], totals: {
      lines_added: null, lines_removed: 0, api_ms: 0, tool_ms: 0,
      thinking_tokens_est: null, compactions: [],
    } },
  }))
  assert.ok(html.includes('−0'))
  assert.ok(html.includes('Turn 1: —'))
  assert.ok(!html.includes('$99'))
  assert.ok(!html.includes('NaN'))
})

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'http'
import express from 'express'
import { dbOps } from '../src/db'
import { replayRouter } from '../src/routes/replay'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

// live-tab-v2 S8 — GET /api/sessions/:id/turns

const app = express()
app.use(replayRouter)
const server = http.createServer(app)
let PORT = 0

function getJSON(path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http.get({ hostname: 'localhost', port: PORT, path }, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(buf) }) }
        catch { resolve({ status: res.statusCode!, body: buf }) }
      })
    }).on('error', reject)
  })
}

describe('GET /api/sessions/:id/turns', () => {
  before((_, done) => { server.listen(0, () => { PORT = (server.address() as any).port; done() }) })
  after((_, done) => { server.close(() => done()) })

  test('unknown session id returns 404', async () => {
    const res = await getJSON('/api/sessions/does-not-exist/turns')
    assert.equal(res.status, 404)
    assert.equal(res.body.error, 'session not found')
  })

  test('returns turns with S1-S4 fields plus session totals', async () => {
    const sid = 'turns-route-cc-0001'
    dbOps.upsertSession({ id: sid, cwd: '/tmp', started_at: Date.now() })
    dbOps.upsertAssistantTurns(sid, [
      { turn_index: 0, ts: 1000, error_count: 0, output_chars: 1, context_used: 0,
        cost_usd: 0.5, priced: true, input_tokens: 10, output_tokens: 5,
        lines_added: 3, lines_removed: 1, api_ms: 100, tool_ms: 50, thinking_tokens_est: 7 },
      { turn_index: 1, ts: 2000, error_count: 0, output_chars: 1, context_used: 0,
        cost_usd: null, priced: false, input_tokens: 1, output_tokens: 1,
        lines_added: 2, lines_removed: 0, api_ms: 200, tool_ms: 0 },
    ])
    dbOps.upsertCompactions(sid, [{ ts: 1500, trigger: 'auto', pre_tokens: 9000 }])

    const res = await getJSON(`/api/sessions/${sid}/turns`)
    assert.equal(res.status, 200)
    assert.equal(res.body.turns.length, 2)
    assert.equal(res.body.turns[0].cost_usd, 0.5)
    assert.equal(res.body.turns[1].cost_usd, null)

    assert.equal(res.body.totals.lines_added, 5)      // 3 + 2
    assert.equal(res.body.totals.lines_removed, 1)
    assert.equal(res.body.totals.api_ms, 300)
    assert.equal(res.body.totals.tool_ms, 50)
    assert.equal(res.body.totals.thinking_tokens_est, 7)  // only turn 0 has it
    assert.equal(res.body.totals.compactions.length, 1)
    assert.equal(res.body.totals.compactions[0].trigger, 'auto')
  })

  test('a session with no lines/thinking data anywhere (OC) gets null totals, not 0', async () => {
    const sid = 'turns-route-oc-0001'
    dbOps.upsertSession({ id: sid, cwd: '/tmp', started_at: Date.now(), source: 'opencode' })
    dbOps.upsertAssistantTurns(sid, [
      { turn_index: 0, ts: 1000, error_count: 0, output_chars: 1, context_used: 0,
        cost_usd: 0.1, priced: true, input_tokens: 10, output_tokens: 5,
        lines_added: undefined, lines_removed: undefined, api_ms: 50, tool_ms: 20 },
    ])

    const res = await getJSON(`/api/sessions/${sid}/turns`)
    assert.equal(res.status, 200)
    assert.equal(res.body.totals.lines_added, null)
    assert.equal(res.body.totals.lines_removed, null)
    assert.equal(res.body.totals.thinking_tokens_est, null)
    assert.equal(res.body.totals.api_ms, 50)   // always a number — never null
  })
})

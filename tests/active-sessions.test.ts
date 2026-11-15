import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'http'
import express from 'express'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

// lazy require: the DB module must load after CLAUDESTAT_DB_PATH is set
const { dbOps } = require('../src/db')
const { miscRouter } = require('../src/routes/misc')

const app = express()
app.use(miscRouter)
const server = http.createServer(app)
let PORT = 0

function get(pathname: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get({ hostname: 'localhost', port: PORT, path: pathname }, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => resolve(JSON.parse(buf)))
    }).on('error', reject)
  })
}

function liveSession(id: string, source: string, opts: { cwd: string; branch?: string; parent?: string; model: string }) {
  const now = Date.now()
  dbOps.upsertSession({ id, cwd: opts.cwd, started_at: now - 60_000, last_event_at: now, source })
  dbOps.updateSessionLocation(id, opts.cwd, opts.branch)
  if (opts.parent) dbOps.setSessionParent(id, opts.parent)
  dbOps.updateSessionCost(id, {
    input_tokens: 100, output_tokens: 10, cache_read: 0, cache_creation: 0, cost_usd: 0.05,
    context_used: 100, context_window: 200_000, lastModel: opts.model,
  }, 100, 0)
  dbOps.insertEvent({ session_id: id, type: 'Done', tool_name: 'Read', ts: now - 1_000, source })
}

// S4 — every live session, with its parent/child relation
describe('GET /api/active-sessions', () => {
  // the archived-session filter reads OpenCode's own DB: point it at an empty one
  const prevOcDb = process.env.OPENCODE_DB
  before((_, done) => {
    process.env.OPENCODE_DB = require('path').join(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'cs-s4-')), 'opencode.db')
    liveSession('s4-cc-parent-0001', 'claude-code', { cwd: '/work/a', branch: 'feat/a', model: 'claude-opus-5-5' })
    liveSession('agent-s4child00001', 'claude-code', { cwd: '/work/a', parent: 's4-cc-parent-0001', model: 'claude-sonnet-5' })
    liveSession('s4-cc-other-00001', 'claude-code', { cwd: '/work/b', branch: 'main', model: 'claude-opus-5-5' })
    liveSession('ses_s4ocsession01', 'opencode', { cwd: '/work/c', model: 'gpt-6.1-sol' })
    server.listen(0, () => { PORT = (server.address() as any).port; done() })
  })
  after((_, done) => {
    if (prevOcDb === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = prevOcDb
    server.close(() => done())
  })

  test('view=all returns every live session with source, parent, project, branch, model, state', async () => {
    const all: any[] = await get('/api/active-sessions?view=all')
    const byId = new Map(all.map(s => [s.sessionId, s]))
    for (const id of ['s4-cc-parent-0001', 'agent-s4child00001', 's4-cc-other-00001', 'ses_s4ocsession01']) {
      assert.ok(byId.has(id), `missing ${id}`)
    }
    const kid = byId.get('agent-s4child00001')
    assert.equal(kid.source, 'claude-code')
    assert.equal(kid.parentId, 's4-cc-parent-0001')
    assert.equal(kid.project, '/work/a')
    const parent = byId.get('s4-cc-parent-0001')
    assert.equal(parent.parentId, null)
    assert.equal(parent.branch, 'feat/a')
    assert.equal(parent.model, 'claude-opus-5-5')
    assert.ok(['working', 'waiting_for_input', 'idle'].includes(parent.state))
    assert.equal(byId.get('ses_s4ocsession01').source, 'opencode')
  })

  test('without view the grouped shape is unchanged: one entry per source, no children', async () => {
    const grouped: any[] = await get('/api/active-sessions')
    assert.deepEqual(grouped.map(s => s.source).sort(), ['claude-code', 'opencode'])
    assert.ok(grouped.every(s => !s.sessionId.startsWith('agent-')))
    assert.deepEqual(Object.keys(grouped[0]).sort(), [
      'cache_creation', 'cache_read', 'cost_usd', 'input_tokens', 'last_seen_ms',
      'model', 'output_tokens', 'project', 'sessionId', 'source',
    ])
  })
})

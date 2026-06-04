import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dbOps } from '../src/db'

test('upsertOrchRun: inserts a new run and getOrchRun returns it', () => {
  const startedAt = new Date().toISOString()
  dbOps.upsertOrchRun({
    run_key: 'oc-test-1',
    project_path: '/tmp/oc',
    project_name: null,
    goal: 'test goal',
    status: 'active',
    total_cycles: 1,
    started_at: startedAt,
    ended_at: null,
    metrics_json: null,
    snapshot_json: null,
  })

  const result = dbOps.getOrchRun('oc-test-1')
  assert.ok(result)
  assert.equal(result.run_key, 'oc-test-1')
  assert.equal(result.status, 'active')
})

test('upsertOrchRun: updates status and total_cycles on conflict', () => {
  const startedAt = new Date().toISOString()
  dbOps.upsertOrchRun({
    run_key: 'oc-test-2',
    project_path: '/tmp/oc',
    project_name: null,
    goal: null,
    status: 'active',
    total_cycles: 1,
    started_at: startedAt,
    ended_at: null,
    metrics_json: null,
    snapshot_json: null,
  })

  dbOps.upsertOrchRun({
    run_key: 'oc-test-2',
    project_path: '/tmp/oc',
    project_name: null,
    goal: null,
    status: 'done',
    total_cycles: 5,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    metrics_json: null,
    snapshot_json: null,
  })

  const result = dbOps.getOrchRun('oc-test-2')
  assert.ok(result)
  assert.equal(result.status, 'done')
  assert.equal(result.total_cycles, 5)
})

test('getOrchRuns: returns only runs for the given project_path', () => {
  const startedAt = new Date().toISOString()
  dbOps.upsertOrchRun({
    run_key: 'oc-list-1',
    project_path: '/tmp/proj-oc',
    project_name: null,
    goal: null,
    status: 'active',
    total_cycles: 1,
    started_at: startedAt,
    ended_at: null,
    metrics_json: null,
    snapshot_json: null,
  })
  dbOps.upsertOrchRun({
    run_key: 'oc-list-2',
    project_path: '/tmp/proj-oc',
    project_name: null,
    goal: null,
    status: 'done',
    total_cycles: 3,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    metrics_json: null,
    snapshot_json: null,
  })
  dbOps.upsertOrchRun({
    run_key: 'oc-list-other',
    project_path: '/tmp/other-proj',
    project_name: null,
    goal: null,
    status: 'active',
    total_cycles: 1,
    started_at: startedAt,
    ended_at: null,
    metrics_json: null,
    snapshot_json: null,
  })

  const result = dbOps.getOrchRuns('/tmp/proj-oc')
  assert.ok(result.length >= 2, `expected >= 2 runs, got ${result.length}`)
  assert.ok(result.every(r => r.project_path === '/tmp/proj-oc'), 'all runs should match project_path')
})
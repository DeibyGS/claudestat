import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mergeLiveEvent } from '../dashboard/src/lib/liveEvents'

// Live log merge: a `Done` closes its PreToolUse; JSONL-only calls (hooks off) arrive as a bare `Done`
describe('mergeLiveEvent', () => {
  test('a Done with a tool_use_id and no matching Pre is appended (hooks off)', () => {
    const out = mergeLiveEvent([], { type: 'Done', tool_name: 'Read', tool_use_id: 'toolu_1', ts: 10 })
    assert.deepEqual(out.map(e => [e.type, e.tool_name]), [['Done', 'Read']])
  })

  test('parallel calls of the same tool: the Done closes the Pre with its own id', () => {
    const events = [
      { type: 'PreToolUse', tool_name: 'Read', tool_use_id: 'toolu_a', ts: 1 },
      { type: 'PreToolUse', tool_name: 'Read', tool_use_id: 'toolu_b', ts: 2 },
    ]
    const out = mergeLiveEvent(events, { type: 'Done', tool_name: 'Read', tool_use_id: 'toolu_a', ts: 7 })
    assert.deepEqual(out.map(e => [e.tool_use_id, e.type]), [['toolu_a', 'Done'], ['toolu_b', 'PreToolUse']])
    assert.equal(out[0].duration_ms, 6)
  })

  test('the hook Pre/Post of a call the JSONL already showed is not added twice', () => {
    let events = mergeLiveEvent([], { type: 'Done', tool_name: 'Bash', tool_use_id: 'toolu_c', ts: 5 })
    events = mergeLiveEvent(events, { type: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_c', ts: 6 })
    events = mergeLiveEvent(events, { type: 'Done', tool_name: 'Bash', tool_use_id: 'toolu_c', ts: 9 })
    assert.equal(events.length, 1)
  })

  test('regression: a Done without id still closes the latest Pre of that tool, unmatched ones are dropped', () => {
    const events = [{ type: 'PreToolUse', tool_name: 'Grep', ts: 1 }]
    const out = mergeLiveEvent(events, { type: 'Done', tool_name: 'Grep', ts: 4 })
    assert.deepEqual(out.map(e => [e.type, e.duration_ms]), [['Done', 3]])
    assert.equal(mergeLiveEvent([], { type: 'Done', tool_name: 'Grep', ts: 4 }).length, 0)
  })
})

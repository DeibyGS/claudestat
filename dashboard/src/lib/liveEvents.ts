import type { TraceEvent } from '../types'

/**
 * Merges one SSE `event` into the live log. A `Done` closes its PreToolUse —
 * by `tool_use_id` when the call carries one, else the latest Pre of that tool.
 * Calls read from the JSONL (hooks off) arrive as a bare `Done` with an id and
 * are appended; the hook's own Pre/Post for a call already shown is skipped.
 */
export function mergeLiveEvent(events: TraceEvent[], evt: TraceEvent): TraceEvent[] {
  const id = evt.tool_use_id
  if (id) {
    const i = events.findIndex(e => e.tool_use_id === id)
    if (i === -1) return [...events, evt]
    if (evt.type !== 'Done' || events[i].type !== 'PreToolUse') return events
    const next = [...events]
    next[i] = { ...next[i], type: 'Done', duration_ms: evt.ts - next[i].ts }
    return next
  }
  if (evt.type === 'Done' && evt.tool_name) {
    const idx = [...events].reverse().findIndex(e => e.type === 'PreToolUse' && e.tool_name === evt.tool_name)
    if (idx === -1) return events
    const next = [...events]
    const ri = next.length - 1 - idx
    next[ri] = { ...next[ri], type: 'Done', duration_ms: evt.ts - next[ri].ts }
    return next
  }
  return [...events, evt]
}

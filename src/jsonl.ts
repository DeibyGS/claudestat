/**
 * jsonl.ts — Helpers for Claude Code JSONL trace quirks.
 *
 * Claude Code writes ONE JSONL line per content block of the same API call:
 * every line repeats message.id and the full usage of the call (e.g. line1 =
 * [thinking], line2 = [text], line3 = [tool_use]). Consumers that accumulate
 * tokens/cost must count each message.id exactly once.
 */

/**
 * Returns true when this message.id was already counted in `seenIds`.
 * Lines without a string id are never treated as duplicates.
 * Pass a Set scoped to the file/session scan.
 */
export function isDuplicateMessageId(id: unknown, seenIds: Set<string>): boolean {
  if (typeof id !== 'string') return false
  if (seenIds.has(id)) return true
  seenIds.add(id)
  return false
}

/**
 * Claude Code writes a single `cost-state` line carrying the session's
 * authoritative total (totalCostUSD). Returns it when present and positive,
 * undefined otherwise (line is not a cost-state, or total is 0/invalid).
 */
export function readCostStateUsd(obj: { type?: unknown; totalCostUSD?: unknown }): number | undefined {
  if (obj.type !== 'cost-state') return undefined
  return typeof obj.totalCostUSD === 'number' && obj.totalCostUSD > 0
    ? obj.totalCostUSD
    : undefined
}

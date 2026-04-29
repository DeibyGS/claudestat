import type { CostInfo, QuotaData, TraceEvent } from '../../types'

// ─── Precios por millón de tokens ─────────────────────────────────────────────
export const PRICE_PER_M = {
  sonnet: 6.6,   // blended ~70% input / 30% output
  haiku:  1.76,
  opus:   33.0,
}

// Cache savings per million tokens (full input price - cached price)
export function cacheSavingsPerM(model?: string): number {
  if (model?.includes('opus'))  return 13.50  // $15/M → $1.50/M cached
  if (model?.includes('haiku')) return 0.22   // $0.25/M → $0.03/M cached
  return 2.70                                  // Sonnet: $3/M → $0.30/M cached
}

export function getModelPrice(model: string): number {
  if (model.includes('opus'))  return PRICE_PER_M.opus
  if (model.includes('haiku')) return PRICE_PER_M.haiku
  return PRICE_PER_M.sonnet
}

export function getModelShortName(model: string): string {
  if (model.includes('opus'))  return 'Opus'
  if (model.includes('haiku')) return 'Haiku'
  return 'Sonnet'
}

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface SessionPrompt { index: number; ts: number; text: string }

export type TipLevel = 'error' | 'warning' | 'info' | 'success'

export interface CoachTip {
  level:        TipLevel
  title:        string
  text:         string
  prompt?:      string   // prompt del usuario que originó el problema
  blockIndex?:  number   // bloque de referencia (para navegación)
}

export interface LoopOccurrence {
  blockIndex: number   // número del bloque (1-based)
  toolName:   string
  count:      number
  detail?:    string   // archivo o comando específico
  multiFile:  boolean  // true = distintos archivos en el loop
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

export function fmtUsd(n: number): string {
  if (n === 0)    return '$0.00'
  if (n < 0.001)  return '<$0.001'
  if (n < 0.01)   return `$${n.toFixed(4)}`
  if (n < 1)      return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

// ─── Coach: detección de loops por bloque ─────────────────────────────────────

// Detects consecutive runs of the same tool per block
export function detectLoopsFromEvents(events: TraceEvent[], threshold = 5): LoopOccurrence[] {
  const results: LoopOccurrence[] = []
  let blockIdx = 0
  let blockTools: TraceEvent[] = []

  function analyzeBlock(idx: number, tools: TraceEvent[]) {
    if (tools.length === 0) return
    let i = 0
    while (i < tools.length) {
      const name = tools[i].tool_name!
      let j = i + 1
      while (j < tools.length && tools[j].tool_name === name) j++
      const count = j - i
      if (count >= threshold) {
        const slice = tools.slice(i, j)
        // Extraer detalle según tool
        let detail: string | undefined
        let multiFile = false
        if (['Read', 'Edit', 'Write', 'Glob', 'Grep'].includes(name)) {
          const files = new Set<string>()
          for (const t of slice) {
            try {
              const inp = JSON.parse(t.tool_input || '{}')
              const p = inp.file_path || inp.pattern || inp.path || ''
              if (p) files.add(p.split('/').pop() || p)
            } catch {}
          }
          multiFile = files.size > 1
          detail = files.size === 1 ? [...files][0] : files.size > 1 ? `${files.size} different files` : undefined
          // Parallel reads of different files is normal — only flag same-file re-reads or very high counts
          if (multiFile && count < 6) { i = j; continue }
        } else if (name.includes('mem_save')) {
          // Only flag if the same topic is saved repeatedly — different topics = intentional behavior, not a loop
          const topics = new Set<string>()
          for (const t of slice) {
            try { const inp = JSON.parse(t.tool_input || '{}'); if (inp.topic) topics.add(inp.topic) } catch {}
          }
          multiFile = topics.size > 1
          detail = topics.size === 1 ? [...topics][0] : undefined
          if (multiFile) { i = j; continue }
        } else if (name === 'Bash') {
          try {
            const cmd: string = JSON.parse(slice[0].tool_input || '{}').command || ''
            detail = cmd.length > 50 ? cmd.slice(0, 48) + '…' : cmd
          } catch {}
        }
        results.push({ blockIndex: idx + 1, toolName: name, count, detail, multiFile })
      }
      i = j
    }
  }

  for (const ev of events) {
    if (ev.type === 'Stop') {
      analyzeBlock(blockIdx, blockTools)
      blockIdx++
      blockTools = []
    } else if ((ev.type === 'Done' || ev.type === 'PreToolUse') && ev.tool_name) {
      blockTools.push(ev)
    }
  }
  if (blockTools.length > 0) analyzeBlock(blockIdx, blockTools)
  return results
}

// Specific advice per tool type
export function loopAdvice(toolName: string, multiFile: boolean, detail?: string): string {
  switch (toolName) {
    case 'Read':
      if (multiFile)
        return `Claude is reading different files in sequence without processing information between reads. Group exploration with Glob/Grep first to reduce the number of Reads.`
      return `"${detail || 'the file'}" was read multiple times in a row. Use offset+limit to read only the necessary section, or Grep to search without reading the entire file. Re-reading the same file wastes context tokens.`
    case 'Edit':
      return `"${detail || 'the file'}" was edited multiple times in a row. This happens when instructions are imprecise — Claude attempts the edit, fails or it doesn't match expectations, and retries. Be more specific: indicate the exact change (old_string → new_string) instead of describing the result.`
    case 'Write':
      return `"${detail || 'the file'}" was overwritten multiple times. Consolidate all changes into a single instruction instead of writing intermediate versions.`
    case 'Bash':
      return `Repeated command: "${detail || '…'}". Bash loops are usually retries due to error. Verify that the previous command succeeded before continuing, or ask Claude to show the error output.`
    case 'Grep':
    case 'Glob':
      return `Repeated searches with similar patterns. Claude is searching for something it can't find. Try a broader pattern or use Read to see the directory structure directly.`
    default:
      if (toolName.includes('mem_save'))
        return `The same topic "${detail || '…'}" was saved in Engram multiple times in a row. Use mem_update to edit an existing observation instead of creating duplicates.`
      return `The tool ${toolName} was executed multiple times in a row. Check if Claude is ignoring previous results.`
  }
}

export function generateTips(cost?: CostInfo, quota?: QuotaData, events?: TraceEvent[], prompts?: SessionPrompt[]): CoachTip[] {
  const tips: CoachTip[] = []

  // 1. Loops por bloque (desde eventos — más granular que cost.loops)
  if (events && events.length > 0) {
    const loopOccurrences = detectLoopsFromEvents(events, 5)

    // Group by tool to avoid repeating the same type of warning
    const byTool = new Map<string, LoopOccurrence[]>()
    for (const o of loopOccurrences) {
      const arr = byTool.get(o.toolName) || []
      arr.push(o)
      byTool.set(o.toolName, arr)
    }

    for (const [toolName, occs] of byTool) {
      const blockRefs  = occs.map(o => `#${o.blockIndex}`).join(', ')
      const totalCount = occs.reduce((s, o) => s + o.count, 0)
      const first      = occs[0]
      // Prompt that triggered the first block with loop (block N → prompt index N)
      const triggerPrompt = prompts?.find(p => p.index === first.blockIndex)?.text
      tips.push({
        level:       'error',
        title:       `Loop: ${toolName} ×${totalCount} — bloques ${blockRefs}`,
        text:        loopAdvice(toolName, first.multiFile, first.detail),
        prompt:      triggerPrompt,
        blockIndex:  first.blockIndex,
      })
    }
  } else if (cost?.loops && cost.loops.length > 0) {
    // Fallback if we don't have events
    for (const l of cost.loops) {
      tips.push({
        level: 'error',
        title: `Loop: ${l.toolName} ×${l.count}`,
        text: loopAdvice(l.toolName, false),
      })
    }
  }

  // 2. Re-reads (same file ≥3 times, NOT consecutive — pattern distinct from loop)
  if (events && events.length > 0) {
    const readCounts = new Map<string, number>()
    for (const e of events) {
      if (e.tool_name === 'Read' && e.type === 'Done' && e.tool_input) {
        try {
          const fp: string = JSON.parse(e.tool_input).file_path || ''
          if (fp) readCounts.set(fp, (readCounts.get(fp) || 0) + 1)
        } catch {}
      }
    }
    const reReads = [...readCounts.entries()].filter(([, c]) => c >= 5)
    if (reReads.length > 0) {
      const names = reReads.map(([f, c]) => `${f.split('/').pop()} (×${c})`).join(', ')
      tips.push({
        level: 'warning',
        title: `Scattered re-reads: ${reReads.length} file${reReads.length > 1 ? 's' : ''}`,
        text: `${names}. These reads are not consecutive but add up to many context tokens. Consider saving the structure mentally before continuing to edit, or use Grep instead of reading the entire file.`,
      })
    }
  }

  // 3. Low cache hit
  if (cost) {
    const total = cost.input_tokens + cost.cache_read + cost.cache_creation
    const hitRate = total > 5000 ? cost.cache_read / total : -1
    if (hitRate >= 0 && hitRate < 0.30) {
      tips.push({
        level: 'warning',
        title: `Low cache hit: ${Math.round(hitRate * 100)}%`,
        text: 'Claude caches context automatically in long sessions. Avoid manually clearing history and work in continuous sessions to accumulate cache.',
      })
    }
  }

  // 4. Low efficiency
  if (cost && cost.efficiency_score > 0 && cost.efficiency_score < 70) {
    tips.push({
      level: 'warning',
      title: `Low efficiency: ${cost.efficiency_score}/100`,
      text: 'Loops and re-reads are consuming tokens unnecessarily. Check if Claude is repeating steps or if instructions are ambiguous.',
    })
  }

  // 5. High burn rate
  if (quota && quota.burnRateTokensPerMin > 6000) {
    tips.push({
      level: 'info',
      title: `High burn rate: ${quota.burnRateTokensPerMin.toLocaleString()} tok/min`,
      text: 'You are consuming tokens very quickly. Consider asking for more concise responses, avoid attaching large complete files, or break the task into steps.',
    })
  }

  // 6. Bash overuse
  if (events && events.length > 0) {
    const done = events.filter(e => e.type === 'Done')
    const bashCount = done.filter(e => e.tool_name === 'Bash').length
    const readCount = done.filter(e => e.tool_name === 'Read').length
    const grepCount = done.filter(e => e.tool_name === 'Grep').length
    if (bashCount > 6 && grepCount < Math.floor(bashCount * 0.3) && readCount > 4) {
      tips.push({
        level: 'info',
        title: `Bash+Read without Grep (${bashCount} Bash, ${readCount} Read)`,
        text: 'You are combining Bash and Read to search for information. Grep is more efficient for searching within files — use Grep before Read when you don\'t know what line something is on.',
      })
    }
  }

  // 7. High quota
  if (quota && quota.cyclePct > 70) {
    tips.push({
      level: quota.cyclePct > 85 ? 'error' : 'warning',
      title: `Quota at ${quota.cyclePct}%`,
      text: `You used ${quota.cyclePrompts}/${quota.cycleLimit} prompts in the 5h window. Group several changes in a single message instead of sending one by one.`,
    })
  }

  // 8. Best practices
  if (cost && cost.cache_read > 30_000) {
    const savings = (cost.cache_read / 1_000_000) * cacheSavingsPerM(cost.model)
    if (savings > 0.02) {
      tips.push({
        level: 'success',
        title: `Optimal cache — saving ${fmtUsd(savings)}`,
        text: 'You are making good use of prompt cache. Long and continuous sessions maximize savings.',
      })
    }
  }
  if (cost && cost.efficiency_score >= 90) {
    tips.push({
      level: 'success',
      title: `Excellent efficiency: ${cost.efficiency_score}/100`,
      text: 'No loops detected in this session. Good work pace.',
    })
  }

  return tips
}

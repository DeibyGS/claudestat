// Pricing per 1M tokens (USD). Add/update models as needed.
export interface ModelPrice {
  input:  number // USD per 1M input tokens
  output: number // USD per 1M output tokens
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  // DeepSeek
  'deepseek-chat':              { input: 0.27,  output: 1.10  },
  'deepseek-v3':                { input: 0.27,  output: 1.10  },
  'deepseek-reasoner':          { input: 0.55,  output: 2.19  },
  'deepseek-r1':                { input: 0.55,  output: 2.19  },
  // Qwen
  'qwen2.5-coder-32b-instruct': { input: 0.07,  output: 0.21  },
  'qwen-turbo':                 { input: 0.05,  output: 0.15  },
  'qwen-plus':                  { input: 0.40,  output: 1.20  },
  'qwen-max':                   { input: 2.40,  output: 9.60  },
  // Gemini
  'gemini-2.0-flash':           { input: 0.10,  output: 0.40  },
  'gemini-2.0-flash-thinking':  { input: 0.10,  output: 0.40  },
  'gemini-1.5-pro':             { input: 1.25,  output: 5.00  },
  'gemini-1.5-flash':           { input: 0.075, output: 0.30  },
  // Claude (fallback — claudestat already tracks CC cost natively)
  'claude-sonnet-4-6':          { input: 3.00,  output: 15.00 },
  'claude-opus-4-6':            { input: 15.00, output: 75.00 },
  'claude-haiku-4-5':           { input: 0.80,  output: 4.00  },
}

// Average tokens per tool call type — used when real tokens are unavailable.
const TOOL_TOKEN_ESTIMATE: Record<string, number> = {
  bash:    300,
  read:   1500,
  edit:    800,
  write:  1000,
  glob:    200,
  grep:    400,
  default: 300,
}

export function estimateTokensFromToolCounts(toolCounts: Record<string, number>): number {
  let total = 0
  for (const [tool, count] of Object.entries(toolCounts)) {
    const key = tool.toLowerCase()
    const avg = TOOL_TOKEN_ESTIMATE[key] ?? TOOL_TOKEN_ESTIMATE.default
    total += avg * count
  }
  return Math.round(total)
}

export function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  const key = Object.keys(MODEL_PRICING).find(k => model.toLowerCase().includes(k)) ?? ''
  const price = MODEL_PRICING[key]
  if (!price) return 0
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output
}

export function findPricing(model: string): ModelPrice | null {
  const key = Object.keys(MODEL_PRICING).find(k => model.toLowerCase().includes(k))
  return key ? MODEL_PRICING[key] : null
}

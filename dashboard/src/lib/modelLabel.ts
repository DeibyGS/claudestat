/**
 * modelLabel.ts — Fuente única para derivar nombre/color de modelo del ID real.
 *
 * Reglas:
 *  - Familias Anthropic (opus/sonnet/haiku) → "Opus 5.5", "Sonnet 4.6", "Haiku 4.5"
 *    (versión derivada del ID; IDs solo-familia tipo alias "sonnet" → sin versión)
 *  - Marcas conocidas (deepseek, gpt, qwen, gemini, llama, glm, mimo, kimi) → nombre
 *    de marca sin versión
 *  - Resto → primeras 2 palabras del ID con mayúscula inicial
 */

export interface ModelStyle {
  name: string
  color: string
  bg: string
}

const FALLBACK_COLOR = '#8b949e'

const FAMILIES: Record<string, { name: string; color: string }> = {
  opus:   { name: 'Opus',   color: '#d29922' },
  sonnet: { name: 'Sonnet', color: '#58a6ff' },
  haiku:  { name: 'Haiku',  color: '#3fb950' },
}

const BRANDS: Array<{ re: RegExp; name: string; color?: string }> = [
  { re: /deepseek/,        name: 'DeepSeek', color: '#c9a0ff' },
  { re: /(^|[^a-z])gpt/,   name: 'GPT',      color: '#74aa9c' },
  { re: /qwen/,            name: 'Qwen',     color: '#f0883e' },
  { re: /gemini/,          name: 'Gemini',   color: '#4285f4' },
  { re: /llama/,           name: 'Llama',    color: '#b39ddb' },
  { re: /glm/,             name: 'GLM',      color: '#00bcd4' },
  { re: /mimo/,            name: 'Mimo' },
  { re: /kimi/,            name: 'Kimi' },
]

function resolve(model?: string | null): { name: string; color: string } {
  if (!model) return { name: 'Unknown', color: FALLBACK_COLOR }

  const base = (model.split('/').pop() ?? model).toLowerCase()

  for (const [key, family] of Object.entries(FAMILIES)) {
    if (!base.includes(key)) continue
    // 'claude-opus-5-5' → 5.5 · 'claude-sonnet-4-6-20250514' → 4.6 ·
    // 'sonnet' (alias) → sin versión · fechas dígitas (≥3) no casan
    const m = base.match(new RegExp(`(?:^|[-_])${key}[-_]?v?(\\d{1,2})(?:[-_.](\\d{1,2}))?(?!\\d)`))
    const version = m ? (m[2] ? `${m[1]}.${m[2]}` : m[1]) : ''
    return { name: `${family.name}${version ? ' ' + version : ''}`, color: family.color }
  }

  for (const brand of BRANDS) {
    if (brand.re.test(base)) return { name: brand.name, color: brand.color ?? FALLBACK_COLOR }
  }

  const bare = base.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  const words = bare.split('-').filter(Boolean).slice(0, 2).join(' ')
  return { name: words ? words.charAt(0).toUpperCase() + words.slice(1) : base, color: FALLBACK_COLOR }
}

/** 'claude-opus-5-5' → 'Opus 5.5' · 'mimo-v2.6-flash-free' → 'Mimo' */
export function modelLabel(model?: string | null): string {
  return resolve(model).name
}

/** Color de familia/marca para el ID dado. */
export function modelColor(model?: string | null): string {
  return resolve(model).color
}

/** Nombre + color + fondo translúcido (patrón de badges en Header/Trace). */
export function modelStyle(model?: string | null): ModelStyle | null {
  if (!model) return null
  const { name, color } = resolve(model)
  return { name, color, bg: color + '12' }
}

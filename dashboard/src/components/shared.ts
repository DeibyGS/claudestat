import type { ReactNode } from 'react'
import type { SessionMode } from '../types'

// ── Formatters ──

export function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return '<1m'
}

export function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) {
    const k = Math.round(n / 1_000)
    return k >= 1000 ? `${(k / 1000).toFixed(1)}M` : `${k}K`
  }
  return String(n)
}

export function fmtHours(h: number): string {
  if (h < 1/60) return '<1m'
  if (h < 1) return `${Math.round(h * 60)}m`
  return `${h.toFixed(1)}h`
}

export function fmtCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return usd >= 10 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(3)}`
}

// ── Model helpers ──

export function shortModel(m: string): string {
  return m.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/^opencode-go\//, '')
}

// ── Source helpers ──

export function sourceColor(source?: string): string {
  if (source === 'opencode')              return '#3fb950'
  if (source === 'claude-code')           return '#58a6ff'
  if (source === 'opencode & claude-code') return '#bc8cff'
  return '#8b949e'
}

export function sourceLabel(source?: string): string {
  if (source === 'claude-code')           return 'Claude Code'
  if (source === 'opencode')              return 'OpenCode'
  if (source === 'opencode & claude-code') return 'OC + CC'
  return source ?? '—'
}

// ── Mode helpers ──

export const MODE_COLOR: Record<SessionMode, string> = {
  directo:          '#7d8590',
  agentes:          '#d29922',
  skills:           '#58a6ff',
  'agentes+skills': '#d29922',
  'sub-agente':     '#8b949e',
}

export const MODE_LABEL: Record<SessionMode, string> = {
  directo:          'direct',
  agentes:          'agents',
  skills:           'skills',
  'agentes+skills': 'agents+skills',
  'sub-agente':     'sub-agent',
}

export const MODE_TOOLTIP: Record<SessionMode, string> = {
  directo:          'Claude responded directly, without launching sub-agents or invoking skills',
  agentes:          'Sub-agents (Agent tool) were launched during the session',
  skills:           'Skills (Skill tool) were invoked during the session',
  'agentes+skills': 'Both sub-agents and skills were used in this session',
  'sub-agente':     'Background sub-agent spawned by the parent session — no tool events recorded separately',
}

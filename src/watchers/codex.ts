/**
 * codex.ts — WatcherAdapter para Codex (OpenAI CLI coding agent)
 *
 * Codex stores traces in ~/.codex/logs/ as JSONL files.
 * Format differs from Claude Code — this is a scaffold.
 * Fill in parseEvent/getSessionCost once you have sample traces.
 */

import path from 'path'
import os from 'os'
import fs from 'fs'
import { type WatcherAdapter, type ParsedEvent, registerAdapter } from './adapter'
import type { CostUpdate } from '../db'

const CODEX_DIR = path.join(os.homedir(), '.codex', 'logs')

export const codexAdapter: WatcherAdapter = {
  name: 'codex',
  label: 'Codex',
  get shortName() { return 'Codex' },

  detect(): boolean {
    try {
      return fs.existsSync(CODEX_DIR)
    } catch {
      return false
    }
  },

  getWatchPaths(): string[] {
    return [`${CODEX_DIR}/**/*.jsonl`]
  },

  parseEvent(_raw: string, _filePath: string): ParsedEvent | null {
    // TODO: implement when Codex trace format is known
    return null
  },

  async getSessionCost(_filePath: string): Promise<CostUpdate | null> {
    // TODO: implement when Codex trace format is known
    return null
  },
}

registerAdapter(codexAdapter)

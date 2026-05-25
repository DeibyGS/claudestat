/**
 * opencode.ts — WatcherAdapter para OpenCode
 *
 * OpenCode stores traces in ~/.opencode/logs/ as JSONL files.
 * Format is similar to Claude Code but with different field names.
 * This is a scaffold — fill in parseEvent/getSessionCost with sample traces.
 */

import path from 'path'
import os from 'os'
import fs from 'fs'
import { type WatcherAdapter, type ParsedEvent, registerAdapter } from './adapter'
import type { CostUpdate } from '../db'

const OPENCODE_DIR = path.join(os.homedir(), '.opencode', 'logs')

export const opencodeAdapter: WatcherAdapter = {
  name: 'opencode',
  label: 'OpenCode',
  get shortName() { return 'OC' },

  detect(): boolean {
    try {
      return fs.existsSync(OPENCODE_DIR)
    } catch {
      return false
    }
  },

  getWatchPaths(): string[] {
    return [`${OPENCODE_DIR}/**/*.jsonl`]
  },

  parseEvent(_raw: string, _filePath: string): ParsedEvent | null {
    // TODO: implement when OpenCode trace format is known
    return null
  },

  async getSessionCost(_filePath: string): Promise<CostUpdate | null> {
    // TODO: implement when OpenCode trace format is known
    return null
  },
}

registerAdapter(opencodeAdapter)

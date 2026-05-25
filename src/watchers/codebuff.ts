/**
 * codebuff.ts — WatcherAdapter para Codebuff (coding CLI agent)
 *
 * Codebuff stores traces in ~/.codebuff/logs/ as JSONL files.
 * This is a scaffold — fill in parseEvent/getSessionCost with sample traces.
 */

import path from 'path'
import os from 'os'
import fs from 'fs'
import { type WatcherAdapter, type ParsedEvent, registerAdapter } from './adapter'
import type { CostUpdate } from '../db'

const CODEBUFF_DIR = path.join(os.homedir(), '.codebuff', 'logs')

export const codebuffAdapter: WatcherAdapter = {
  name: 'codebuff',
  label: 'Codebuff',
  get shortName() { return 'CB' },

  detect(): boolean {
    try {
      return fs.existsSync(CODEBUFF_DIR)
    } catch {
      return false
    }
  },

  getWatchPaths(): string[] {
    return [`${CODEBUFF_DIR}/**/*.jsonl`]
  },

  parseEvent(_raw: string, _filePath: string): ParsedEvent | null {
    // TODO: implement when Codebuff trace format is known
    return null
  },

  async getSessionCost(_filePath: string): Promise<CostUpdate | null> {
    // TODO: implement when Codebuff trace format is known
    return null
  },
}

registerAdapter(codebuffAdapter)

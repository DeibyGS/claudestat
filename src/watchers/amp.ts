/**
 * amp.ts — WatcherAdapter para Amp (coding CLI agent)
 *
 * Amp stores traces in ~/.amp/logs/ as JSONL files.
 * This is a scaffold — fill in parseEvent/getSessionCost with sample traces.
 */

import path from 'path'
import os from 'os'
import fs from 'fs'
import { type WatcherAdapter, type ParsedEvent, registerAdapter } from './adapter'
import type { CostUpdate } from '../db'

const AMP_DIR = path.join(os.homedir(), '.amp', 'logs')

export const ampAdapter: WatcherAdapter = {
  name: 'amp',
  label: 'Amp',
  get shortName() { return 'Amp' },

  detect(): boolean {
    try {
      return fs.existsSync(AMP_DIR)
    } catch {
      return false
    }
  },

  getWatchPaths(): string[] {
    return [`${AMP_DIR}/**/*.jsonl`]
  },

  parseEvent(_raw: string, _filePath: string): ParsedEvent | null {
    // TODO: implement when Amp trace format is known
    return null
  },

  async getSessionCost(_filePath: string): Promise<CostUpdate | null> {
    // TODO: implement when Amp trace format is known
    return null
  },
}

registerAdapter(ampAdapter)

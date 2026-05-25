/**
 * droid.ts — WatcherAdapter para Droid (coding CLI agent)
 *
 * Droid stores traces in ~/.droid/logs/ as JSONL files.
 * This is a scaffold — fill in parseEvent/getSessionCost with sample traces.
 */

import path from 'path'
import os from 'os'
import fs from 'fs'
import { type WatcherAdapter, type ParsedEvent, registerAdapter } from './adapter'
import type { CostUpdate } from '../db'

const DROID_DIR = path.join(os.homedir(), '.droid', 'logs')

export const droidAdapter: WatcherAdapter = {
  name: 'droid',
  label: 'Droid',
  get shortName() { return 'Droid' },

  detect(): boolean {
    try {
      return fs.existsSync(DROID_DIR)
    } catch {
      return false
    }
  },

  getWatchPaths(): string[] {
    return [`${DROID_DIR}/**/*.jsonl`]
  },

  parseEvent(_raw: string, _filePath: string): ParsedEvent | null {
    // TODO: implement when Droid trace format is known
    return null
  },

  async getSessionCost(_filePath: string): Promise<CostUpdate | null> {
    // TODO: implement when Droid trace format is known
    return null
  },
}

registerAdapter(droidAdapter)

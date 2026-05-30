// ─── /api/intent/* — Multi-tool file coordination ─────────────────────────────

import crypto from 'crypto'
import fs from 'fs'
import { Router, type Request, type Response } from 'express'
import { dbOps }    from '../db'
import { broadcast } from './stream'

function computeHash(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const content = fs.readFileSync(filePath)
    return crypto.createHash('sha256').update(content).digest('hex')
  } catch { return null }
}

interface IntentFile {
  file_path: string
  operation?: 'read' | 'write'
  line_start?: number
  line_end?: number
}

// Middleware para validar required `id` en body
const validateId = (req: Request, res: Response, next: Function) => {
  const { id } = req.body
  if (!id) {
    res.status(400).json({ error: 'id is required' })
    return
  }
  next()
}

export const intentsRouter = Router()

// POST /api/intent/declare
// Body: { tool, session_id, task_desc?, files: [{ file_path, operation?, line_start?, line_end? }] }
// Returns: { id, status: 'acquired'|'blocked', blocked_by?, files? }
intentsRouter.post('/api/intent/declare', (req: Request, res: Response) => {
  const { tool, session_id, task_desc, files } = req.body

  if (!tool || !session_id || !Array.isArray(files) || files.length === 0) {
    res.status(400).json({ error: 'tool, session_id and files[] are required' })
    return
  }

  const writeFiles = (files as IntentFile[]).filter(f => !f.operation || f.operation === 'write')
  const writePaths = writeFiles
    .map(f => f.file_path)
    .filter((p): p is string => typeof p === 'string' && p.startsWith('/'))

  if (writePaths.length < writeFiles.length) {
    res.status(400).json({ error: 'file_path must be an absolute path (starting with /)' })
    return
  }

  // Check conflicts from other tools
  const conflicts = writePaths.length > 0 ? dbOps.getWriteConflicts(writePaths, tool) : []

  if (conflicts.length > 0) {
    const blockedBy = conflicts[0].tool
    broadcast({ type: 'intent_conflict', payload: {
      files: conflicts.map(c => c.file_path),
      locked_by: blockedBy,
      session_id: conflicts[0].session_id,
      task: conflicts[0].task_desc,
    }})
    res.json({
      id: null, status: 'blocked',
      blocked_by: blockedBy,
      files: conflicts.map(c => c.file_path),
    })
    return
  }

  // Acquire
  const id = dbOps.insertIntent(tool, session_id, task_desc)
  const filePaths: string[] = []
  for (const f of files as IntentFile[]) {
    if (f.file_path) {
      dbOps.insertIntentFile(id, f.file_path, f.operation ?? 'write', f.line_start, f.line_end)
      filePaths.push(f.file_path)
    }
  }

  broadcast({ type: 'intent_declared', payload: { tool, files: filePaths, task: task_desc } })

  res.json({ id, status: 'acquired' })
})

// POST /api/intent/done
// Body: { id }
intentsRouter.post('/api/intent/done', validateId, (req: Request, res: Response) => {
  const { id } = req.body

  const intent = dbOps.getIntent(id)
  const files = dbOps.getIntentFiles(id)
  dbOps.releaseIntent(id)

  for (const f of files) {
    broadcast({ type: 'intent_released', payload: { file: f.file_path, operation: f.operation, tool: intent?.tool } })
  }

  res.json({ ok: true })
})

// POST /api/intent/heartbeat
// Body: { id }
intentsRouter.post('/api/intent/heartbeat', validateId, (req: Request, res: Response) => {
  const { id } = req.body
  dbOps.heartbeatIntent(id)
  res.json({ ok: true })
})

// GET /api/intent/status?files=path1,path2
intentsRouter.get('/api/intent/status', (req: Request, res: Response) => {
  const raw          = req.query.files        as string | undefined
  const tool         = req.query.exclude_tool as string | undefined
  const paths = raw ? raw.split(',').map(p => p.trim()).filter(Boolean) : []

  if (paths.length === 0) {
    res.json({ conflicts: [] })
    return
  }

  const conflicts = dbOps.getWriteConflicts(paths, tool ?? '')
  res.json({
    conflicts: conflicts.map(c => ({
      file:       c.file_path,
      locked_by:  c.tool,
      task:       c.task_desc,
      since:      c.acquired_at,
    })),
  })
})

// POST /api/intent/check-hash — verify files haven't changed since last known hash
// Body: { files: [{ file_path: string, hash: string }] }
// Returns: { safe: boolean, changed: Array<{ file_path, current_hash }> }
intentsRouter.post('/api/intent/check-hash', (req: Request, res: Response) => {
  const { files } = req.body
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ error: 'files[] is required' })
    return
  }
  const changed: Array<{ file_path: string; current_hash: string }> = []
  for (const f of files as Array<{ file_path: string; hash?: string }>) {
    const current = computeHash(f.file_path)
    if (current && f.hash && current !== f.hash) {
      changed.push({ file_path: f.file_path, current_hash: current })
    }
  }
  res.json({ safe: changed.length === 0, changed })
})

// GET /api/intent/hashes?files=/abs/path1,/abs/path2
// Returns current SHA256 hashes for the given file paths
intentsRouter.get('/api/intent/hashes', (req: Request, res: Response) => {
  const raw   = req.query.files as string | undefined
  const paths = raw ? raw.split(',').map(p => p.trim()).filter((p): p is string => !!p && p.startsWith('/')) : []
  if (paths.length === 0) {
    res.status(400).json({ error: 'files query param required (comma-separated absolute paths)' })
    return
  }
  const hashes: Record<string, string | null> = {}
  for (const p of paths) {
    hashes[p] = computeHash(p)
  }
  res.json({ hashes })
})

// GET /api/intent/active — list all currently active intents
intentsRouter.get('/api/intent/active', (_req: Request, res: Response) => {
  const intents = dbOps.getActiveIntents()
  res.json({ intents })
})

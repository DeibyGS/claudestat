import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'

/** Sube el árbol desde un file_path hasta encontrar HANDOFF.md → directorio del proyecto */
export function findProjectCwdForFile(filePath: string): string | undefined {
  let dir = path.dirname(filePath)
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'HANDOFF.md'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Fallback: git root
  return findGitRoot(path.dirname(filePath))
}

/**
 * Returns the git root directory for the given directory, or undefined.
 * Uses 'git rev-parse --show-toplevel' — fast and reliable.
 */
export function findGitRoot(fromDir: string): string | undefined {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd: fromDir,
      stdio: 'pipe',
      timeout: 2000,
    }).toString().trim()
    return root || undefined
  } catch {
    return undefined
  }
}

import path from 'path'
import fs from 'fs'

/** Sube el árbol desde un file_path hasta encontrar HANDOFF.md → directorio del proyecto */
export function findProjectCwdForFile(filePath: string): string | undefined {
  let dir = path.dirname(filePath)
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'HANDOFF.md'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

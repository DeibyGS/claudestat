/**
 * paths.ts — Cross-platform path resolution for Claude Code data directories
 *
 * Claude Code stores data in the same location on all platforms:
 *   All platforms: ~/.claude/
 *
 * ClaudeStat stores its own data in:
 *   All platforms: ~/.claudestat/  (or CLAUDESTAT_DATA_DIR env var)
 *
 * Claude Code encodes project paths by replacing path separators AND colons with '-'.
 * This module provides helpers to encode/decode those paths cross-platform.
 */

import os   from 'os'
import path from 'path'
import fs   from 'fs'

const isWin = process.platform === 'win32'

// ─── Binary detection ──────────────────────────────────────────────────────────

/**
 * Detecta si claudestat está corriendo como binario standalone (Bun compile)
 * vs desde npm (node dist/index.js).
 */
export function isBinary(): boolean {
  const arg1 = process.argv[1] ?? ''
  return !arg1.includes('node_modules') && !arg1.includes('dist/index.js')
    && !arg1.includes('tsx') && arg1.includes('claudestat')
}

/**
 * Retorna el directorio base del binario o del proyecto.
 * En binario: directorio donde está el ejecutable.
 * En npm: root del proyecto (unimos dist/..).
 */
export function getBinaryDir(): string {
  if (isBinary()) {
    return path.dirname(process.argv[1])
  }
  return path.join(__dirname, '..')
}

/**
 * Retorna el directorio del dashboard build (dashboard/dist/).
 * En binario: busca relativo al binario o en CLAUDESTAT_DATA_DIR.
 * En npm: usa __dirname para encontrar dist/.
 */
export function getDashboardDir(): string {
  if (isBinary()) {
    const candidates = [
      path.join(getBinaryDir(), 'dashboard'),
      path.join(getClaudestatDir(), 'dashboard'),
      path.join(getBinaryDir(), '..', 'dashboard', 'dist'),
    ]
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, 'index.html'))) return c
    }
  }
  return path.join(__dirname, '..', 'dashboard', 'dist')
}

// ─── Claude Code data directory ────────────────────────────────────────────────

/**
 * Returns the Claude Code data directory (~/.claude on all platforms).
 * Empirically verified: Claude Code CLI stores settings at ~/.claude on macOS, Linux, and Windows.
 */
export function getClaudeDir(): string {
  return process.env.CLAUDE_DIR ?? path.join(os.homedir(), '.claude')
}

// ─── ClaudeStat data directory ─────────────────────────────────────────────────

/**
 * Returns the ClaudeStat data directory.
 * Can be overridden via CLAUDESTAT_DATA_DIR env var.
 */
export function getClaudestatDir(): string {
  return process.env.CLAUDESTAT_DATA_DIR ?? path.join(os.homedir(), '.claudestat')
}

/**
 * Returns the PID file path for the daemon.
 */
export function getPidFile(): string {
  return path.join(getClaudestatDir(), 'daemon.pid')
}

// ─── Path encoding (Claude Code format) ────────────────────────────────────────

/**
 * Encodes a real filesystem path into Claude Code's internal format.
 * Claude Code replaces path separators AND colons with '-'.
 *
 *   macOS:   /Users/db/Documents/GitHub → -Users-db-Documents-GitHub
 *   Windows: C:\Users\db\Documents      → C--Users-db-Documents
 */
export function encodeClaudePath(realPath: string): string {
  return realPath.replace(/[/\\:]/g, '-')
}

/**
 * Decodes a Claude Code encoded directory name back to a real filesystem path.
 *
 * Since directory names with '-' are ambiguous (is "gmail-ai-agent" one dir or three?),
 * this function requires a reference to the greedy filesystem resolver.
 * Use project-scanner's findRealPath for the actual resolution.
 *
 * Returns the encodedHome + rest with '-' replaced by path.sep,
 * but actual resolution should be done via findRealPath in project-scanner.
 */
export function decodeClaudePath(encoded: string): string | null {
  const homeDir = os.homedir()
  const encodedHome = encodeClaudePath(homeDir)

  if (!encoded.startsWith(encodedHome)) return null

  const rest = encoded.slice(encodedHome.length)
  if (!rest || rest === '') return null

  // Replace '-' with path separator — but note this is ambiguous for dirs with '-'
  // For actual resolution, use findRealPath() from project-scanner
  return homeDir + rest.replace(/-/g, path.sep)
}

/**
 * Creates the regex pattern for the encoded home path.
 * Handles both / and \ separators.
 */
export function homeSlugRegex(): RegExp {
  const escaped = encodeClaudePath(os.homedir()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + escaped)
}

/**
 * Returns the engram-compatible slug for the home directory.
 * Used for MEMORY.md path resolution.
 *   macOS:   /Users/db   → -Users-db
 *   Windows: C:\Users\db → C--Users-db
 */
export function getHomeSlug(): string {
  return encodeClaudePath(os.homedir())
}

// ─── OpenCode data directory ───────────────────────────────────────────────────

/**
 * Returns the OpenCode config directory.
 * Can be overridden via OPENCODE_CONFIG_DIR env var.
 */
export function getOpencodeDir(): string {
  return process.env.OPENCODE_CONFIG_DIR ?? path.join(os.homedir(), '.config', 'opencode')
}

/**
 * Returns the OpenCode SQLite database path.
 * Can be overridden via OPENCODE_DB env var.
 */
export function getOpencodeDb(): string {
  return process.env.OPENCODE_DB ?? path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db')
}

// ─── Platform utilities ────────────────────────────────────────────────────────

/**
 * Returns the appropriate command to find an executable in PATH.
 *   Unix:    which <name>
 *   Windows: where <name>
 */
export function whichCmd(name: string): string {
  return isWin ? `where ${name}` : `which ${name}`
}

/**
 * Returns the appropriate command to find all instances of an executable in PATH.
 *   Unix:    which -a <name>
 *   Windows: where <name>  (where already lists all matches)
 */
export function whichAllCmd(name: string): string {
  return isWin ? `where ${name}` : `which -a ${name} 2>/dev/null`
}

/**
 * Returns the appropriate command to check if a port is in use.
 *   Unix:    lsof -i :<port>
 *   Windows: netstat -ano | findstr :<port>
 */
export function portCheckCmd(port: number): string {
  return isWin
    ? `netstat -ano | findstr :${port}`
    : `lsof -i :${port}`
}

/**
 * Returns true if running on Windows.
 */
export const isWindows = isWin
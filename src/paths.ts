/**
 * paths.ts — Cross-platform path resolution for Claude Code data directories
 *
 * Claude Code stores data in different locations depending on the OS:
 *   macOS/Linux: ~/.claude/
 *   Windows:     %APPDATA%/claude/  (e.g. C:\Users\<user>\AppData\Roaming\claude\)
 *
 * ClaudeStat stores its own data in:
 *   All platforms: ~/.claudestat/  (or CLAUDESTAT_DATA_DIR env var)
 *
 * Claude Code encodes project paths by replacing path separators with '-'.
 * This module provides helpers to encode/decode those paths cross-platform.
 */

import os   from 'os'
import path from 'path'

const isWin = process.platform === 'win32'

// ─── Claude Code data directory ────────────────────────────────────────────────

/**
 * Returns the Claude Code data directory for the current platform:
 *   macOS/Linux: ~/.claude
 *   Windows:     %APPDATA%/claude
 */
export function getClaudeDir(): string {
  if (isWin) {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'claude'
    )
  }
  return path.join(os.homedir(), '.claude')
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
 * Claude Code replaces path separators with '-'.
 *
 *   macOS:  /Users/db/Documents/GitHub → -Users-db-Documents-GitHub
 *   Windows: C:\Users\db\Documents     → -C--Users-db-Documents
 *
 * On Windows, also strips the colon after the drive letter (C: → C).
 */
export function encodeClaudePath(realPath: string): string {
  const normalized = realPath.replace(/[/\\]/g, '-')
  // On Windows, "C:-Users-db" → strip the colon: "C--Users-db" → keep as-is
  // Claude Code on Windows may keep the colon; we normalize it away
  return normalized.replace(/^([A-Za-z]):/, '$1')
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
  const homeDir = os.homedir()
  const encoded = homeDir.replace(/[/\\]/g, '-')
  // Escape special regex chars in the encoded path
  const escaped = encoded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + escaped)
}

/**
 * Returns the engram-compatible slug for the home directory.
 * Used for MEMORY.md path resolution.
 *   macOS:  /Users/db  → -Users-db
 *   Windows: C:\Users\db → -C--Users-db
 */
export function getHomeSlug(): string {
  return os.homedir().replace(/[/\\]/g, '-').replace(/^([A-Za-z]):/, '$1')
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
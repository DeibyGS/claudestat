/**
 * lib-guard.ts — Daemon health guard for the public library API (v1.13.0)
 *
 * @experimental Surface may change in any minor/patch release until v2.0.0.
 *
 * Behavior:
 *   - configure({throwOnNoDaemon?: boolean}) overrides env CLAUDESTAT_LIB_THROW_ON_NO_DAEMON
 *   - checkDaemonOrThrow() probes HTTP /health via curl; throws DaemonNotRunningError on failure
 *     (or warns + proceeds if throwOnNoDaemon=false). Verdict cached for process lifetime.
 *   - wrapDbOps(original) returns a Proxy whose first property access triggers checkDaemonOrThrow();
 *     pure-module re-exports never touch this and so never trigger the guard.
 *
 * Port resolution: CLAUDESTAT_DAEMON_PORT env > readConfig().port
 */
import { spawnSync } from 'child_process'
import { readConfig } from './config'

export class DaemonNotRunningError extends Error {
  constructor() {
    super('claudestat daemon is not running. Start it with: claudestat start')
    this.name = 'DaemonNotRunningError'
  }
}

interface LibConfig {
  throwOnNoDaemon: boolean
}

let libConfig: LibConfig = {
  throwOnNoDaemon: process.env.CLAUDESTAT_LIB_THROW_ON_NO_DAEMON !== '0',
}

let daemonVerified = false

/**
 * Configure the library guard. Last call wins.
 * Resolution order: explicit configure() > env CLAUDESTAT_LIB_THROW_ON_NO_DAEMON > default true
 */
export function configure(opts: Partial<LibConfig>): void {
  if (opts.throwOnNoDaemon !== undefined) {
    libConfig.throwOnNoDaemon = opts.throwOnNoDaemon
  }
  daemonVerified = false
}

function resolveDaemonPort(): number {
  const envPort = process.env.CLAUDESTAT_DAEMON_PORT
  if (envPort) {
    const parsed = parseInt(envPort, 10)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return readConfig().port
}

function isCurlAvailable(): boolean {
  const r = spawnSync('which', ['curl'], { stdio: 'ignore' })
  return r.status === 0
}

/**
 * Probe the daemon's /health endpoint via curl. Synchronous, ~10ms overhead.
 * Throws DaemonNotRunningError if the daemon is unreachable and throwOnNoDaemon is true.
 * If throwOnNoDaemon is false, warns once and proceeds (cached).
 * If curl is missing on the host, warns and proceeds (treats as opt-out).
 */
export function checkDaemonOrThrow(): void {
  if (daemonVerified) return

  if (!libConfig.throwOnNoDaemon) {
    console.warn('[claudestat] daemon check skipped (throwOnNoDaemon=false). Reads may return stale data.')
    daemonVerified = true
    return
  }

  if (!isCurlAvailable()) {
    console.warn('[claudestat] curl not found in PATH — skipping daemon check. Verify claudestat is running.')
    daemonVerified = true
    return
  }

  const port = resolveDaemonPort()
  const result = spawnSync(
    'curl',
    ['-s', '-o', '/dev/null', '-m', '1', '-w', '%{http_code}', `http://127.0.0.1:${port}/health`],
    { encoding: 'utf8' }
  )

  const httpCode = (result.stdout ?? '').trim()
  const ok = result.status === 0 && httpCode === '200'

  if (!ok) {
    throw new DaemonNotRunningError()
  }

  daemonVerified = true
}

/**
 * Wrap a dbOps object with a Proxy that triggers checkDaemonOrThrow() on first
 * property access. Pure-module re-exports never touch this wrapper.
 * After the first successful check, access passes through without re-probing.
 */
export function wrapDbOps<T extends object>(original: T): T {
  return new Proxy(original, {
    get(target, prop, receiver) {
      checkDaemonOrThrow()
      return Reflect.get(target, prop, receiver)
    },
  }) as T
}
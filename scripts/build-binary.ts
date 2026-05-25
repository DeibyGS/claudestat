/**
 * build-binary.ts — Compila claudestat a binario standalone con Bun
 *
 * Uso:
 *   bun run scripts/build-binary.ts          # build para plataforma actual
 *   bun run scripts/build-binary.ts --all    # build multi-plataforma (requiere Docker)
 *
 * Requisitos:
 *   - Bun >= 1.2 (https://bun.sh)
 *   - Node >= 22 (para build del dashboard)
 *
 * El binario incluye:
 *   - Todo el código TypeScript compilado
 *   - Dependencias de producción (express, chokidar, commander)
 *   - Dashboard build (dashboard/dist/)
 *
 * NOTA: node:sqlite (SQLite nativo de Node 22) no existe en Bun.
 *   Para binarios standalone se usa better-sqlite3 como fallback.
 *   Ver src/db.ts línea 12 — el factory detecta el entorno automáticamente.
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync, cpSync } from 'fs'
import { join } from 'path'
import { platform, arch } from 'os'

const ROOT = join(import.meta.dirname, '..')
const DIST = join(ROOT, 'dist')

type Target = { name: string; target: string }

const TARGETS: Target[] = [
  { name: `claudestat-macos-arm64`, target: 'bun-darwin-arm64' },
  { name: `claudestat-macos-x64`,   target: 'bun-darwin-x64' },
  { name: `claudestat-linux-x64`,   target: 'bun-linux-x64' },
  { name: `claudestat-linux-arm64`, target: 'bun-linux-arm64' },
  { name: `claudestat-win-x64.exe`, target: 'bun-windows-x64' },
]

function step(label: string) {
  console.log(`\n  • ${label}`)
}

function getCurrentTarget(): Target {
  const p = platform() === 'darwin' ? 'macos' : platform() === 'win32' ? 'win' : 'linux'
  const a = arch() === 'arm64' ? 'arm64' : 'x64'
  const ext = p === 'win' ? '.exe' : ''
  return { name: `claudestat-${p}-${a}${ext}`, target: `bun-${p === 'macos' ? 'darwin' : p === 'win' ? 'windows' : 'linux'}-${a}` }
}

async function buildBinary(target: Target, outputDir: string) {
  step(`Compilando ${target.name}...`)
  execSync(
    `bun build --compile --target ${target.target} ` +
    `--outfile ${join(outputDir, target.name)} ` +
    `${join(DIST, 'index.js')}`,
    { cwd: ROOT, stdio: 'inherit' }
  )
  console.log(`  ✅ ${target.name}`)
}

async function main() {
  const args = process.argv.slice(2)
  const buildAll = args.includes('--all')
  const outputDir = join(ROOT, 'bin')
  mkdirSync(outputDir, { recursive: true })

  console.log(`\n╒══════════════════════════════════════╕`)
  console.log(`│  claudestat — Binary build           │`)
  console.log(`╘══════════════════════════════════════╛`)

  // 1. Build TypeScript
  step('Compilando TypeScript...')
  execSync('npx tsc', { cwd: ROOT, stdio: 'inherit' })

  // 2. Build dashboard
  step('Compilando dashboard...')
  execSync('npm run build:dashboard', { cwd: ROOT, stdio: 'inherit' })

  // 3. Copiar dashboard/dist a dist/dashboard (accesible desde binario)
  step('Copiando dashboard...')
  const dashboardDist = join(DIST, 'dashboard')
  if (!existsSync(dashboardDist)) mkdirSync(dashboardDist, { recursive: true })
  cpSync(join(ROOT, 'dashboard', 'dist'), dashboardDist, { recursive: true })

  // 4. Build binary(es)
  if (buildAll) {
    step(`Compilando ${TARGETS.length} plataformas (puede tomar minutos)...`)
    for (const t of TARGETS) await buildBinary(t, outputDir)
  } else {
    const current = getCurrentTarget()
    step(`Compilando para plataforma actual: ${current.name}`)
    await buildBinary(current, outputDir)
  }

  console.log(`\n  📁 Binarios en: ${outputDir}/`)
  console.log(`  ✅ Build complete\n`)
}

main().catch(err => {
  console.error('Build failed:', err)
  process.exit(1)
})

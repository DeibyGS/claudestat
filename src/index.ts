#!/usr/bin/env node
/**
 * index.ts — Entry point del CLI
 *
 * Suprimimos el ExperimentalWarning de node:sqlite antes de importar nada.
 * El módulo funciona perfectamente — el warning es solo informativo.
 */

// Filtrar solo el warning de SQLite, dejar pasar el resto
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && w.message.includes('SQLite')) return
  process.stderr.write(`${w.name}: ${w.message}\n`)
})

import { Command } from 'commander'
import { startDaemon }              from './daemon'
import { startWatch }               from './watch'
import { installHooks, uninstallHooks } from './install'

const program = new Command()

program
  .name('claudetrace')
  .description('Real-time execution trace and cost intelligence for Claude Code')
  .version('0.1.0')

program
  .command('start')
  .description('Iniciar el daemon (recibe eventos de Claude Code en background)')
  .action(startDaemon)

program
  .command('watch')
  .description('Ver el trace de ejecución en tiempo real en la terminal')
  .action(() => startWatch().catch(err => {
    console.error('\n❌ Error:', err.message)
    process.exit(1)
  }))

program
  .command('install')
  .description('Instalar los hooks de claudetrace en Claude Code (~/.claude/settings.json)')
  .action(installHooks)

program
  .command('uninstall')
  .description('Eliminar los hooks de claudetrace de Claude Code')
  .action(uninstallHooks)

program.parse()

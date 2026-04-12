#!/usr/bin/env node
/**
 * index.ts — Entry point del CLI
 *
 * Commander parsea los argumentos de línea de comando y
 * delega a cada módulo según el subcomando.
 */

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

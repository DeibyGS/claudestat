/**
 * Declaración de tipos para node:sqlite (experimental en Node 22).
 * node:sqlite es el módulo SQLite integrado en Node.js — sin compilación nativa.
 */
declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: any[]): { changes: number; lastInsertRowid: number | bigint }
    get(...params: any[]): Record<string, any> | undefined
    all(...params: any[]): Record<string, any>[]
    iterate?(...params: any[]): IterableIterator<Record<string, any>>
  }

  export class DatabaseSync {
    constructor(location: string, options?: { open?: boolean; readOnly?: boolean })
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
    readonly open: boolean
  }
}

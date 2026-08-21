import { readdirSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/src/lib/prisma'
import { check, type DiagnosticCheck } from './types'

/** Erros de driver/conexão nem sempre são `instanceof Error` (adapters podem rejeitar com objetos simples). */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * Checks que dependem de conexão real com o banco — cada um é isolado em
 * try/catch próprio: uma falha de conexão não deve impedir de ver os
 * resultados dos checks de configuração (env-checks.ts), que não precisam de rede.
 */
export async function runSystemChecks(): Promise<DiagnosticCheck[]> {
  const results: DiagnosticCheck[] = []

  try {
    await prisma.$queryRaw`SELECT 1`
    results.push(check('db_connection', 'Conexão com o banco', 'ok', 'Conectou e respondeu.'))
  } catch (error) {
    results.push(check('db_connection', 'Conexão com o banco', 'error', `Falhou: ${describeError(error)}`))
    // Sem conexão, nenhum check abaixo tem como funcionar — retorna cedo.
    results.push(check('migrations', 'Migrations aplicadas', 'unknown', 'Não verificado — sem conexão com o banco.'))
    return results
  }

  try {
    const applied = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at ASC
    `
    const appliedNames = new Set(applied.filter((m) => m.finished_at !== null).map((m) => m.migration_name))
    const failedNames = applied.filter((m) => m.finished_at === null).map((m) => m.migration_name)

    let localNames: string[] = []
    try {
      localNames = readdirSync(join(process.cwd(), 'prisma', 'migrations')).filter((name) => name !== 'migration_lock.toml')
    } catch {
      // Ambiente serverless pode não empacotar prisma/migrations — não é um erro dos checks em si.
    }

    const pending = localNames.filter((name) => !appliedNames.has(name))

    if (failedNames.length > 0) {
      results.push(check('migrations', 'Migrations aplicadas', 'error', `${failedNames.length} migration(s) FALHARAM no meio: ${failedNames.join(', ')}.`))
    } else if (localNames.length > 0 && pending.length > 0) {
      results.push(check('migrations', 'Migrations aplicadas', 'warning', `${pending.length} migration(s) pendente(s): ${pending.join(', ')}.`))
    } else if (localNames.length === 0) {
      results.push(check('migrations', 'Migrations aplicadas', 'ok', `${appliedNames.size} migration(s) aplicada(s) no banco (pasta local de migrations não pôde ser lida para comparar).`))
    } else {
      results.push(check('migrations', 'Migrations aplicadas', 'ok', `Todas as ${appliedNames.size} migrations locais estão aplicadas.`))
    }
  } catch (error) {
    results.push(
      check(
        'migrations',
        'Migrations aplicadas',
        'error',
        `Tabela _prisma_migrations não encontrada ou inacessível — nenhuma migration foi aplicada ainda? (${describeError(error)})`,
      ),
    )
    return results
  }

  try {
    const portalCount = await prisma.bitrixPortal.count()
    results.push(check('tables', 'Tabelas essenciais', 'ok', `Schema acessível (${portalCount} portal(is) cadastrado(s)).`))
  } catch (error) {
    results.push(check('tables', 'Tabelas essenciais', 'error', `Não foi possível consultar bitrix_portals: ${describeError(error)}`))
  }

  return results
}

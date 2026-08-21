/**
 * Checklist de diagnóstico do ambiente — roda fora da aplicação (não depende
 * de sessão/portal). Uso: `npx tsx scripts/check-env.ts`.
 *
 * Nunca imprime valor de segredo — só presença/formato/comprimento.
 */
import 'dotenv/config'
import { runEnvChecks } from '../src/modules/diagnostics/env-checks'
import { runSystemChecks } from '../src/modules/diagnostics/system-checks'
import type { DiagnosticCheck } from '../src/modules/diagnostics/types'

const ICON: Record<DiagnosticCheck['status'], string> = {
  ok: '[OK]   ',
  warning: '[WARN] ',
  error: '[ERRO] ',
  unknown: '[??]   ',
}

function printSection(title: string, checks: DiagnosticCheck[]) {
  console.log(`\n${title}`)
  console.log('-'.repeat(title.length))
  for (const c of checks) {
    console.log(`${ICON[c.status]}${c.label}: ${c.message}`)
  }
}

async function main() {
  console.log('Diagnóstico do ambiente — Inventário de TI')

  const envChecks = runEnvChecks()
  printSection('Configuração (variáveis de ambiente)', envChecks)

  const systemChecks = await runSystemChecks()
  printSection('Banco de dados', systemChecks)

  const all = [...envChecks, ...systemChecks]
  const errors = all.filter((c) => c.status === 'error').length
  const warnings = all.filter((c) => c.status === 'warning').length

  console.log(`\nResumo: ${errors} erro(s), ${warnings} aviso(s), ${all.length} check(s) no total.`)
  if (errors > 0) {
    console.log('Corrija os itens marcados [ERRO] antes de seguir para homologação.')
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error('Falha ao rodar o diagnóstico:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    const { prisma } = await import('../src/lib/prisma')
    await prisma.$disconnect()
  })

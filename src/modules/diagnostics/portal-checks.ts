import { prisma } from '@/src/lib/prisma'
import { check, type DiagnosticCheck } from './types'

export interface PortalDiagnosticSummary {
  checks: DiagnosticCheck[]
  usersCount: number
  departmentsCount: number
  lastSyncAt: string | null
  recentErrors: Array<{ at: string; summary: string }>
}

/**
 * Checks ESCOPADOS a um portal — usados pela tela /admin/diagnostics. Nunca
 * inclui o valor do access/refresh token, só se ele está expirado ou não
 * (o app já renova automaticamente no próximo uso — ver src/modules/bitrix/client.ts).
 */
export async function runPortalChecks(portalId: string): Promise<PortalDiagnosticSummary> {
  const checks: DiagnosticCheck[] = []

  const portal = await prisma.bitrixPortal.findUnique({ where: { id: portalId } })
  if (!portal) {
    checks.push(check('portal', 'Portal', 'error', 'Portal não encontrado.'))
    return { checks, usersCount: 0, departmentsCount: 0, lastSyncAt: null, recentErrors: [] }
  }

  checks.push(
    check(
      'portal_status',
      'Status do portal',
      portal.status === 'ACTIVE' ? 'ok' : 'error',
      `${portal.status}${portal.status !== 'ACTIVE' ? ' — instalação incompleta ou revogada.' : ''}`,
    ),
  )

  const tokenExpired = portal.tokenExpiresAt.getTime() < Date.now()
  checks.push(
    check(
      'token_status',
      'Token do Bitrix24',
      tokenExpired ? 'warning' : 'ok',
      tokenExpired
        ? 'Expirado — será renovado automaticamente no próximo uso (nunca exibido, nem em diagnóstico).'
        : `Válido até ${portal.tokenExpiresAt.toISOString()} (nunca exibido, só a validade).`,
    ),
  )

  checks.push(
    check(
      'sync_status',
      'Sincronização de usuários/departamentos',
      portal.syncStatus === 'SUCCESS' ? 'ok' : portal.syncStatus === 'ERROR' ? 'error' : 'warning',
      `${portal.syncStatus}${portal.lastSyncErrorMessage ? ` — ${portal.lastSyncErrorMessage}` : ''}`,
    ),
  )

  const [usersCount, departmentsCount, recentAuditErrors] = await Promise.all([
    prisma.bitrixUser.count({ where: { portalId, active: true } }),
    prisma.bitrixDepartment.count({ where: { portalId, active: true } }),
    prisma.jobExecution.findMany({
      where: { status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { jobType: true, errorMessage: true, updatedAt: true },
    }),
  ])

  return {
    checks,
    usersCount,
    departmentsCount,
    lastSyncAt: portal.lastSyncAt?.toISOString() ?? null,
    recentErrors: recentAuditErrors.map((e) => ({
      at: e.updatedAt.toISOString(),
      summary: `${e.jobType}: ${(e.errorMessage ?? 'erro sem mensagem').slice(0, 200)}`,
    })),
  }
}

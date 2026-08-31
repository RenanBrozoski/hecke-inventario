import { randomUUID } from 'crypto'
import { prisma } from '@/src/lib/prisma'
import { logger } from '@/src/modules/common/logger'
import { paginateBitrixList } from './client'
import { deriveManagerBitrixUserId } from './manager-rule'

interface BitrixUserRaw {
  ID: string
  NAME?: string
  LAST_NAME?: string
  EMAIL?: string
  ACTIVE?: boolean
  WORK_POSITION?: string
  UF_DEPARTMENT?: Array<number | string>
}

interface BitrixDepartmentRaw {
  ID: string
  NAME: string
  PARENT?: string | number | null
  UF_HEAD?: string | number | null
}

export interface SyncResult {
  runId: string
  usersUpserted: number
  departmentsUpserted: number
  usersDeactivated: number
  departmentsDeactivated: number
}

/**
 * Sincroniza usuários e departamentos de um portal com o Bitrix24, usando
 * exclusivamente o client centralizado (paginateBitrixList). Idempotente e
 * seguro contra falhas parciais: registros ausentes só são marcados inativos
 * DEPOIS que toda a paginação de usuários E departamentos termina com sucesso
 * — qualquer erro no meio do caminho não inativa nada (o catch nunca chega lá).
 */
export async function syncPortalUsersAndDepartments(portalId: string): Promise<SyncResult> {
  const runId = randomUUID()

  // Reivindicação atômica: só entra em execução se não houver outra rodando
  // para este portal (evita duas sincronizações simultâneas desnecessárias).
  const claim = await prisma.bitrixPortal.updateMany({
    where: { id: portalId, syncStatus: { not: 'RUNNING' } },
    data: { syncStatus: 'RUNNING' },
  })
  if (claim.count !== 1) {
    throw new Error(`Já existe uma sincronização em andamento para o portal ${portalId}.`)
  }

  try {
    const [rawUsers, rawDepartments] = await Promise.all([
      paginateBitrixList<BitrixUserRaw>(portalId, 'user.get', { ACTIVE: true }, { idempotent: true }),
      paginateBitrixList<BitrixDepartmentRaw>(portalId, 'department.get', {}, { idempotent: true }),
    ])

    const departmentLookup = rawDepartments.map((d) => ({
      bitrixDepartmentId: String(d.ID),
      headBitrixUserId: d.UF_HEAD ? String(d.UF_HEAD) : null,
    }))

    const syncedAt = new Date()

    // Batch all department upserts in a single transaction (one round-trip)
    await prisma.$transaction(
      rawDepartments.map((dept) =>
        prisma.bitrixDepartment.upsert({
          where: { portalId_bitrixDepartmentId: { portalId, bitrixDepartmentId: String(dept.ID) } },
          create: {
            portalId,
            bitrixDepartmentId: String(dept.ID),
            name: dept.NAME,
            parentBitrixDepartmentId: dept.PARENT ? String(dept.PARENT) : null,
            headBitrixUserId: dept.UF_HEAD ? String(dept.UF_HEAD) : null,
            active: true,
            lastSyncedAt: syncedAt,
            lastSeenSyncId: runId,
          },
          update: {
            name: dept.NAME,
            parentBitrixDepartmentId: dept.PARENT ? String(dept.PARENT) : null,
            headBitrixUserId: dept.UF_HEAD ? String(dept.UF_HEAD) : null,
            active: true,
            lastSyncedAt: syncedAt,
            lastSeenSyncId: runId,
          },
        }),
      ),
    )

    // Batch all user upserts in chunks of 100 to avoid oversized transactions
    const CHUNK = 100
    for (let i = 0; i < rawUsers.length; i += CHUNK) {
      const chunk = rawUsers.slice(i, i + CHUNK)
      await prisma.$transaction(
        chunk.map((user) => {
          const departmentIds = (user.UF_DEPARTMENT ?? []).map(String)
          const managerBitrixUserId = deriveManagerBitrixUserId(
            String(user.ID),
            departmentIds,
            departmentLookup,
          )
          const fullName =
            [user.NAME, user.LAST_NAME].filter(Boolean).join(' ').trim() || `Usuário ${user.ID}`
          return prisma.bitrixUser.upsert({
            where: { portalId_bitrixUserId: { portalId, bitrixUserId: String(user.ID) } },
            create: {
              portalId,
              bitrixUserId: String(user.ID),
              firstName: user.NAME ?? null,
              lastName: user.LAST_NAME ?? null,
              fullName,
              email: user.EMAIL ?? null,
              position: user.WORK_POSITION ?? null,
              active: user.ACTIVE !== false,
              departmentIds,
              managerBitrixUserId,
              lastSyncedAt: syncedAt,
              lastSeenSyncId: runId,
            },
            update: {
              firstName: user.NAME ?? null,
              lastName: user.LAST_NAME ?? null,
              fullName,
              email: user.EMAIL ?? null,
              position: user.WORK_POSITION ?? null,
              active: user.ACTIVE !== false,
              departmentIds,
              managerBitrixUserId,
              lastSyncedAt: syncedAt,
              lastSeenSyncId: runId,
            },
          })
        }),
      )
    }

    // Só agora — com a paginação inteira de usuários E departamentos concluída
    // com sucesso — inativamos o que não foi visto nesta execução.
    const [deactivatedUsers, deactivatedDepartments] = await Promise.all([
      prisma.bitrixUser.updateMany({
        where: { portalId, lastSeenSyncId: { not: runId }, active: true },
        data: { active: false },
      }),
      prisma.bitrixDepartment.updateMany({
        where: { portalId, lastSeenSyncId: { not: runId }, active: true },
        data: { active: false },
      }),
    ])

    await prisma.bitrixPortal.update({
      where: { id: portalId },
      data: {
        syncStatus: 'SUCCESS',
        lastSyncAt: new Date(),
        lastSyncErrorAt: null,
        lastSyncErrorMessage: null,
      },
    })

    return {
      runId,
      usersUpserted: rawUsers.length,
      departmentsUpserted: rawDepartments.length,
      usersDeactivated: deactivatedUsers.count,
      departmentsDeactivated: deactivatedDepartments.count,
    }
  } catch (error) {
    // Nunca inativa nada aqui — só registra o erro (resumido, sem payload
    // sensível) e deixa os registros existentes como estavam.
    const message = error instanceof Error ? error.message : 'Erro desconhecido na sincronização'
    logger.error({ portalId, err: error }, 'sync: falha na sincronização de usuários/departamentos')
    await prisma.bitrixPortal.update({
      where: { id: portalId },
      data: {
        syncStatus: 'ERROR',
        lastSyncErrorAt: new Date(),
        lastSyncErrorMessage: message.slice(0, 500),
      },
    })
    throw error
  }
}

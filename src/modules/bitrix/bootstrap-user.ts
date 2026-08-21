import { prisma } from '@/src/lib/prisma'
import type { BitrixCurrentUserContext } from './client'

/**
 * Marcador usado em `lastSeenSyncId` para registros criados/atualizados por
 * este bootstrap (fora de uma execução real de sync) — nunca colide com um
 * `runId` real (que é sempre um UUID gerado por syncPortalUsersAndDepartments).
 */
export const HANDLER_BOOTSTRAP_SYNC_MARKER = 'handler-bootstrap'

/**
 * Upsert mínimo do usuário que está abrindo o app, com os dados já validados
 * via `user.current` no handler — resolve a corrida em que a primeira abertura
 * acontece antes do sync completo (Inngest) terminar de popular BitrixUser.
 *
 * Seguro por construção: só é chamado depois que o handler já confirmou
 * `currentUser.ACTIVE !== false` via uma chamada autenticada ao Bitrix24 — ou
 * seja, todo usuário que chega aqui está confirmado como ativo agora mesmo.
 *
 * Nunca deriva `managerBitrixUserId` (isso exige a lista completa de
 * departamentos, que só o sync completo tem) e nunca sobrescreve esse campo
 * numa atualização — só o sync completo (sync.ts) é dono dele. Da mesma forma,
 * `lastSeenSyncId` só é definido na criação (com o marcador acima); numa
 * atualização, não mexe nele, para não interferir na contabilidade de inativação
 * de uma sincronização completa em andamento.
 */
export async function bootstrapUserFromContext(
  portalId: string,
  currentUser: BitrixCurrentUserContext,
): Promise<void> {
  const bitrixUserId = currentUser.ID
  const departmentIds = (currentUser.UF_DEPARTMENT ?? []).map(String)
  const fullName =
    [currentUser.NAME, currentUser.LAST_NAME].filter(Boolean).join(' ').trim() || `Usuário ${bitrixUserId}`

  await prisma.bitrixUser.upsert({
    where: { portalId_bitrixUserId: { portalId, bitrixUserId } },
    create: {
      portalId,
      bitrixUserId,
      firstName: currentUser.NAME ?? null,
      lastName: currentUser.LAST_NAME ?? null,
      fullName,
      email: currentUser.EMAIL ?? null,
      position: currentUser.WORK_POSITION ?? null,
      active: true,
      departmentIds,
      managerBitrixUserId: null,
      lastSyncedAt: new Date(),
      lastSeenSyncId: HANDLER_BOOTSTRAP_SYNC_MARKER,
    },
    update: {
      firstName: currentUser.NAME ?? null,
      lastName: currentUser.LAST_NAME ?? null,
      fullName,
      email: currentUser.EMAIL ?? null,
      position: currentUser.WORK_POSITION ?? null,
      active: true,
      departmentIds,
      lastSyncedAt: new Date(),
    },
  })
}

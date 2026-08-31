import { prisma } from '@/src/lib/prisma'

interface ExtraAdminEntry {
  portalId: string
  bitrixUserId: string
}

/**
 * BITRIX_EXTRA_ADMIN_USER_IDS é uma variável GLOBAL do processo, mas o formato
 * "portalId:bitrixUserId" a torna efetivamente escopada por portal: uma entrada
 * sem o prefixo do portal (ex. "42" sozinho) é ignorada, nunca tratada como
 * "vale para qualquer portal" — isso é o que impede o ID "1" de um portal virar
 * admin de outro portal só por coincidência numérica de bitrixUserId.
 */
function getExtraAdminEntries(): ExtraAdminEntry[] {
  const raw = process.env.BITRIX_EXTRA_ADMIN_USER_IDS ?? ''
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [portalId, bitrixUserId] = entry.split(':').map((part) => part.trim())
      return portalId && bitrixUserId ? { portalId, bitrixUserId } : null
    })
    .filter((entry): entry is ExtraAdminEntry => Boolean(entry))
}

/**
 * Único ponto de verdade para "é administrador" nesta fase — NENHUMA rota deve
 * comparar `installedByBitrixUserId` ou ler `BITRIX_EXTRA_ADMIN_USER_IDS`
 * diretamente. É essa centralização que permite trocar a regra pelo módulo de
 * permissões (RBAC + ACL, Fase 4) sem alterar as rotas de sincronização,
 * diagnóstico ou administração — elas só chamam esta função.
 *
 * Regras desta fase (deliberadamente simples, documentadas como temporárias):
 *   1. quem instalou o app (`BitrixPortal.installedByBitrixUserId`);
 *   2. uma lista extra via env, no formato `portalId:bitrixUserId` (CSV),
 *      escopada por portal (ver getExtraAdminEntries acima).
 */
export function checkPortalAdministrator(
  portal: { id: string; installedByBitrixUserId: string },
  bitrixUserId: string,
): boolean {
  if (portal.installedByBitrixUserId === bitrixUserId) return true
  return getExtraAdminEntries().some(
    (entry) => entry.portalId === portal.id && entry.bitrixUserId === bitrixUserId,
  )
}

export async function isPortalAdministrator(portalId: string, bitrixUserId: string): Promise<boolean> {
  const portal = await prisma.bitrixPortal.findUnique({ where: { id: portalId } })
  if (!portal) return false
  return checkPortalAdministrator(portal, bitrixUserId)
}

/**
 * Lista TODOS os administradores do portal (mesma regra de isPortalAdministrator,
 * mas devolvendo a lista inteira) — usado pelo responsável "ADMIN" de uma
 * etapa do workflow (Fase 4), que precisa resolver para bitrixUserIds concretos,
 * não só responder sim/não para um usuário específico.
 */
export async function listPortalAdministratorBitrixUserIds(portalId: string): Promise<string[]> {
  const portal = await prisma.bitrixPortal.findUnique({ where: { id: portalId } })
  if (!portal) return []

  const ids = new Set<string>([portal.installedByBitrixUserId])
  for (const entry of getExtraAdminEntries()) {
    if (entry.portalId === portalId) ids.add(entry.bitrixUserId)
  }
  return [...ids]
}

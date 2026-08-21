import type { BitrixPortal } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { decryptSecret, encryptSecret } from './crypto'

export interface PortalTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

/**
 * Único ponto que grava tokens da INSTALAÇÃO (não do usuário que abriu o app por
 * último — ver docs/01-planejamento.md e a nota em client.ts). Chamado só pelo
 * fluxo de instalação e pela renovação automática do client centralizado.
 */
export async function savePortalTokens(portalId: string, tokens: PortalTokens): Promise<void> {
  await prisma.bitrixPortal.update({
    where: { id: portalId },
    data: {
      accessTokenEncrypted: encryptSecret(tokens.accessToken),
      refreshTokenEncrypted: encryptSecret(tokens.refreshToken),
      tokenExpiresAt: tokens.expiresAt,
    },
  })
}

export function decryptPortalTokens(portal: {
  accessTokenEncrypted: string
  refreshTokenEncrypted: string
}): { accessToken: string; refreshToken: string } {
  return {
    accessToken: decryptSecret(portal.accessTokenEncrypted),
    refreshToken: decryptSecret(portal.refreshTokenEncrypted),
  }
}

export interface UpsertPortalOnInstallInput {
  domain: string
  memberId: string
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scopes: string[]
  installedByBitrixUserId: string
  installedAt: Date
}

/**
 * Upsert idempotente por `memberId` (a identidade forte da instalação — nunca o
 * `domain`). Reinstalar o mesmo app no mesmo portal atualiza a linha existente
 * (inclusive o domínio, se tiver mudado) em vez de criar uma duplicata. Sempre
 * volta para `status: PENDING` — quem decide promover para ACTIVE é o chamador
 * (ver activatePortal), só depois de confirmar a validação com user.current —
 * isso também é o que reativa um portal que estivesse TOKEN_INVALID.
 *
 * Comportamento definido para reinstalação (item 5 da estabilização):
 *  - `installedAt`/`installedByBitrixUserId` são gravados só na CRIAÇÃO — uma
 *    reinstalação nunca os sobrescreve (preserva "quem instalou originalmente"
 *    e "quando", que é o que isPortalAdministrator() usa como base);
 *  - `sessionVersion` é incrementado a cada reinstalação, invalidando de uma
 *    vez todas as sessões internas emitidas antes (ver session.ts).
 */
export async function upsertPortalOnInstall(input: UpsertPortalOnInstallInput): Promise<BitrixPortal> {
  const accessTokenEncrypted = encryptSecret(input.accessToken)
  const refreshTokenEncrypted = encryptSecret(input.refreshToken)

  return prisma.bitrixPortal.upsert({
    where: { memberId: input.memberId },
    create: {
      domain: input.domain,
      memberId: input.memberId,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt: input.expiresAt,
      scopes: input.scopes,
      status: 'PENDING',
      installedByBitrixUserId: input.installedByBitrixUserId,
      installedAt: input.installedAt,
    },
    update: {
      domain: input.domain,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt: input.expiresAt,
      scopes: input.scopes,
      status: 'PENDING',
      sessionVersion: { increment: 1 },
    },
  })
}

export async function activatePortal(portalId: string): Promise<BitrixPortal> {
  return prisma.bitrixPortal.update({
    where: { id: portalId },
    data: { status: 'ACTIVE' },
  })
}

export async function findPortalByMemberId(memberId: string): Promise<BitrixPortal | null> {
  return prisma.bitrixPortal.findUnique({ where: { memberId } })
}

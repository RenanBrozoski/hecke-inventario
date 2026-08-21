import { createHash, randomBytes } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

const HANDSHAKE_TTL_MS = 60_000

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

export interface CreateHandshakeInput {
  portalId: string
  bitrixUserId: string
  context?: Record<string, unknown>
}

/**
 * Cria um código de handshake de uso único: aleatório e criptograficamente
 * seguro, devolvido em texto puro para o navegador — mas só o HASH é
 * persistido em BitrixHandshake. Expira em ~60s.
 */
export async function createHandshake(input: CreateHandshakeInput): Promise<string> {
  const rawCode = randomBytes(32).toString('base64url')
  const codeHash = hashCode(rawCode)

  await prisma.bitrixHandshake.create({
    data: {
      codeHash,
      portalId: input.portalId,
      bitrixUserId: input.bitrixUserId,
      context: (input.context ?? {}) as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + HANDSHAKE_TTL_MS),
    },
  })

  return rawCode
}

export interface ConsumedHandshake {
  portalId: string
  bitrixUserId: string
}

/**
 * Consome o handshake de forma atômica: o UPDATE só afeta a linha quando
 * `consumedAt` ainda está nulo e `expiresAt` ainda é válido — um único
 * statement, protegido pelo lock de linha do Postgres, então duas trocas
 * concorrentes do mesmo código nunca conseguem consumir as duas (a segunda
 * sempre encontra `count === 0` e recebe null).
 */
export async function consumeHandshake(rawCode: string): Promise<ConsumedHandshake | null> {
  const codeHash = hashCode(rawCode)

  const { count } = await prisma.bitrixHandshake.updateMany({
    where: { codeHash, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  })

  if (count !== 1) return null

  const handshake = await prisma.bitrixHandshake.findUnique({ where: { codeHash } })
  if (!handshake) return null

  return { portalId: handshake.portalId, bitrixUserId: handshake.bitrixUserId }
}

const CLEANUP_BATCH_SIZE = 500

/**
 * Remove handshakes expirados (consumidos ou não) e consumidos antigos —
 * "antigos" aqui é deliberadamente imediato (assim que passam da validade):
 * um handshake consumido não tem mais nenhuma utilidade, então não há motivo
 * de segurança/auditoria para retê-lo. Nunca toca em handshakes ainda válidos
 * (nem expirados, nem consumidos). Processa em lotes (`CLEANUP_BATCH_SIZE`)
 * para não apagar um volume grande de linhas de uma vez só.
 *
 * Disparada pelo cron do Inngest `cleanup-expired-handshakes` (a cada 15 min —
 * ver src/inngest/functions/cleanup-handshakes.ts).
 */
export async function cleanupExpiredHandshakes(olderThan: Date = new Date()): Promise<number> {
  let totalDeleted = 0

  for (;;) {
    const batch = await prisma.bitrixHandshake.findMany({
      where: {
        OR: [{ expiresAt: { lt: olderThan } }, { consumedAt: { not: null, lt: olderThan } }],
      },
      select: { id: true },
      take: CLEANUP_BATCH_SIZE,
    })

    if (batch.length === 0) break

    const { count } = await prisma.bitrixHandshake.deleteMany({
      where: { id: { in: batch.map((h) => h.id) } },
    })
    totalDeleted += count

    if (batch.length < CLEANUP_BATCH_SIZE) break
  }

  return totalDeleted
}

/**
 * Invalida (remove) todo handshake pendente de um portal — usado na
 * reinstalação (item 5 da estabilização), como higiene de segurança: mesmo
 * sendo de uso único e de vida curta (~60s), uma reinstalação não deve deixar
 * nenhum código emitido antes dela continuar valendo.
 */
export async function invalidateHandshakesForPortal(portalId: string): Promise<number> {
  const result = await prisma.bitrixHandshake.deleteMany({ where: { portalId } })
  return result.count
}

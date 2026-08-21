import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export interface RecordAuditEventInput {
  portalId: string
  bitrixUserId: string
  action: string
  entityType: string
  entityId: string
  /** Resumo seguro (contagens, IDs, nomes de campo) — nunca o schema completo nem dado sensível. */
  metadata?: Record<string, unknown>
}

/**
 * Grava um evento de auditoria. Aceita opcionalmente um client de transação
 * (`tx`, o parâmetro recebido dentro de `prisma.$transaction(async (tx) => ...)`)
 * — quando informado, a gravação faz parte da MESMA transação da alteração
 * principal: se a auditoria falhar, a transação inteira reverte (nunca fica
 * "alteração aplicada, auditoria perdida").
 */
export async function recordAuditEvent(
  input: RecordAuditEventInput,
  tx?: TransactionClient,
): Promise<void> {
  const client = tx ?? prisma
  await client.auditLog.create({
    data: {
      portalId: input.portalId,
      bitrixUserId: input.bitrixUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  })
}

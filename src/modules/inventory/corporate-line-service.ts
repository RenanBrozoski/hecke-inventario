import type { InventoryCorporateLineStatus, Prisma, PrismaClient } from '@prisma/client'
import { Prisma as PrismaRuntime } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { recordAuditEvent } from '@/src/modules/audit/log'
import {
  InventoryConflictError,
  type InventoryContext,
  InventoryNotFoundError,
  InventoryValidationError,
} from './http'
import type { CreateCorporateLineInput, UpdateCorporateLineInput } from './schemas'

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

const LINE_INCLUDE = {
  currentHolder: { select: { id: true, name: true, status: true } },
  equipment: {
    select: {
      id: true,
      patrimony: true,
      assetTag: true,
      name: true,
      category: { select: { name: true } },
    },
  },
} satisfies Prisma.InventoryCorporateLineInclude

function dateOnly(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  return value === null ? null : new Date(`${value}T00:00:00.000Z`)
}

export function normalizeCorporateLineNumber(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) {
    throw new InventoryValidationError('Informe um número telefônico válido para a linha corporativa.')
  }
  // Para números nacionais sem DDI, usamos +55 como representação canônica.
  // Números com DDI explícito permanecem intocados para não hardcodear operadora
  // nem assumir uma geografia fora do formato informado.
  const explicitInternationalPrefix = /^\s*(\+|00)/.test(value)
  return !explicitInternationalPrefix && (digits.length === 10 || digits.length === 11)
    ? `55${digits}`
    : digits
}

function conflict(error: unknown): boolean {
  return error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === 'P2002'
}

async function requireHolder(
  tx: TransactionClient,
  portalId: string,
  personId: string | null | undefined,
) {
  if (!personId) return null
  const person = await tx.inventoryPerson.findFirst({
    where: { id: personId, portalId, archivedAt: null, status: { not: 'TERMINATED' } },
    select: { id: true, name: true },
  })
  if (!person) throw new InventoryValidationError('Colaborador inválido para este portal.')
  return person
}

async function requireEquipment(
  tx: TransactionClient,
  portalId: string,
  equipmentId: string | null | undefined,
) {
  if (!equipmentId) return null
  const equipment = await tx.inventoryEquipment.findFirst({
    where: { id: equipmentId, portalId, archivedAt: null },
    select: { id: true, patrimony: true, assetTag: true, name: true },
  })
  if (!equipment) throw new InventoryValidationError('Equipamento inválido para este portal.')
  return equipment
}

function equipmentName(
  item: { patrimony: string | null; assetTag: string | null; name: string | null } | null,
): string | null {
  if (!item) return null
  return item.patrimony || item.assetTag || item.name || null
}

function lineAuditChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of [
    'number',
    'carrier',
    'plan',
    'dataAllowance',
    'status',
    'currentHolderId',
    'equipmentId',
    'simSlot',
    'activatedAt',
    'suspendedAt',
    'cancelledAt',
    'notes',
  ]) {
    if (!before || before[key] !== after[key]) changes[key] = { from: before?.[key] ?? null, to: after[key] ?? null }
  }
  return changes
}

function lineHistoryData(
  context: InventoryContext,
  lineId: string,
  action: string,
  origin: 'MANUAL' | 'IMPORT',
  before: {
    currentHolderId: string | null
    currentHolder?: { name: string } | null
    equipmentId: string | null
    equipment?: { patrimony: string | null; assetTag: string | null; name: string | null } | null
    status: InventoryCorporateLineStatus
    simSlot: string | null
  } | null,
  after: {
    currentHolderId: string | null
    currentHolder?: { name: string } | null
    equipmentId: string | null
    equipment?: { patrimony: string | null; assetTag: string | null; name: string | null } | null
    status: InventoryCorporateLineStatus
    simSlot: string | null
  },
  reason?: string | null,
): Prisma.InventoryCorporateLineHistoryUncheckedCreateInput {
  const label = (equipment: typeof before extends null ? never : NonNullable<typeof before>['equipment']) =>
    equipment?.patrimony || equipment?.assetTag || equipment?.name || null
  return {
    portalId: context.portalId,
    lineId,
    action,
    origin,
    reason,
    fromHolderId: before?.currentHolderId ?? null,
    fromHolderName: before?.currentHolder?.name ?? null,
    toHolderId: after.currentHolderId,
    toHolderName: after.currentHolder?.name ?? null,
    fromEquipmentId: before?.equipmentId ?? null,
    fromEquipmentName: label(before?.equipment ?? null),
    toEquipmentId: after.equipmentId,
    toEquipmentName: label(after.equipment ?? null),
    fromStatus: before?.status ?? null,
    toStatus: after.status,
    fromSimSlot: before?.simSlot ?? null,
    toSimSlot: after.simSlot,
    performedByBitrixUserId: context.bitrixUserId,
    performedByName: context.userName,
  }
}

export async function listCorporateLines(
  portalId: string,
  query: {
    page: number
    pageSize: number
    q?: string
    status?: InventoryCorporateLineStatus
    holderId?: string
    equipmentId?: string
    archived: 'exclude' | 'include' | 'only'
  },
) {
  const where: Prisma.InventoryCorporateLineWhereInput = {
    portalId,
    ...(query.archived === 'exclude' ? { archivedAt: null } : {}),
    ...(query.archived === 'only' ? { archivedAt: { not: null } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.holderId ? { currentHolderId: query.holderId } : {}),
    ...(query.equipmentId ? { equipmentId: query.equipmentId } : {}),
    ...(query.q
      ? {
          OR: [
            { number: { contains: query.q, mode: 'insensitive' } },
            { normalizedNumber: { contains: query.q.replace(/\D/g, '') } },
            { carrier: { contains: query.q, mode: 'insensitive' } },
            { plan: { contains: query.q, mode: 'insensitive' } },
            { currentHolder: { name: { contains: query.q, mode: 'insensitive' } } },
            { equipment: { patrimony: { contains: query.q, mode: 'insensitive' } } },
            { equipment: { assetTag: { contains: query.q, mode: 'insensitive' } } },
            { equipment: { name: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
  const [items, total] = await Promise.all([
    prisma.inventoryCorporateLine.findMany({
      where,
      orderBy: [{ normalizedNumber: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: LINE_INCLUDE,
    }),
    prisma.inventoryCorporateLine.count({ where }),
  ])
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  }
}

export async function getCorporateLine(portalId: string, lineId: string) {
  const line = await prisma.inventoryCorporateLine.findFirst({
    where: { id: lineId, portalId },
    include: {
      ...LINE_INCLUDE,
      history: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!line) throw new InventoryNotFoundError('Linha corporativa não encontrada.')
  return line
}

export async function createCorporateLine(
  context: InventoryContext,
  input: CreateCorporateLineInput,
  origin: 'MANUAL' | 'IMPORT' = 'MANUAL',
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const [holder, equipment] = await Promise.all([
        requireHolder(tx, context.portalId, input.currentHolderId),
        requireEquipment(tx, context.portalId, input.equipmentId),
      ])
      const line = await tx.inventoryCorporateLine.create({
        data: {
          portalId: context.portalId,
          number: input.number,
          normalizedNumber: normalizeCorporateLineNumber(input.number),
          carrier: input.carrier,
          plan: input.plan,
          dataAllowance: input.dataAllowance,
          status: input.status,
          currentHolderId: holder?.id ?? null,
          equipmentId: equipment?.id ?? null,
          simSlot: input.simSlot,
          activatedAt: dateOnly(input.activatedAt),
          suspendedAt: dateOnly(input.suspendedAt),
          cancelledAt: dateOnly(input.cancelledAt),
          notes: input.notes,
        },
        include: LINE_INCLUDE,
      })
      await tx.inventoryCorporateLineHistory.create({
        data: lineHistoryData(context, line.id, 'CREATED', origin, null, line),
      })
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_corporate_line_created',
          entityType: 'InventoryCorporateLine',
          entityId: line.id,
          metadata: { origin, changes: lineAuditChanges(null, line) },
        },
        tx,
      )
      return line
    })
  } catch (error) {
    if (conflict(error)) throw new InventoryConflictError('Este número já está cadastrado neste portal.')
    throw error
  }
}

export async function updateCorporateLine(
  context: InventoryContext,
  lineId: string,
  input: UpdateCorporateLineInput,
  origin: 'MANUAL' | 'IMPORT' = 'MANUAL',
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.inventoryCorporateLine.findFirst({
        where: { id: lineId, portalId: context.portalId, archivedAt: null },
        include: LINE_INCLUDE,
      })
      if (!before) throw new InventoryNotFoundError('Linha corporativa não encontrada.')
      const [holder, equipment] = await Promise.all([
        input.currentHolderId === undefined
          ? Promise.resolve(before.currentHolder)
          : requireHolder(tx, context.portalId, input.currentHolderId),
        input.equipmentId === undefined
          ? Promise.resolve(before.equipment)
          : requireEquipment(tx, context.portalId, input.equipmentId),
      ])
      const number = input.number ?? before.number
      const data: Prisma.InventoryCorporateLineUncheckedUpdateManyInput = {
        ...(input.number !== undefined
          ? { number: input.number, normalizedNumber: normalizeCorporateLineNumber(number) }
          : {}),
        carrier: input.carrier,
        plan: input.plan,
        dataAllowance: input.dataAllowance,
        status: input.status,
        currentHolderId: input.currentHolderId === undefined ? undefined : holder?.id ?? null,
        equipmentId: input.equipmentId === undefined ? undefined : equipment?.id ?? null,
        simSlot: input.simSlot,
        activatedAt: dateOnly(input.activatedAt),
        suspendedAt: dateOnly(input.suspendedAt),
        cancelledAt: dateOnly(input.cancelledAt),
        notes: input.notes,
        revision: { increment: 1 },
      }
      const changed = await tx.inventoryCorporateLine.updateMany({
        where: { id: lineId, portalId: context.portalId, archivedAt: null, revision: input.revision },
        data,
      })
      if (changed.count !== 1) {
        throw new InventoryConflictError('A linha foi alterada por outra pessoa. Recarregue e tente novamente.')
      }
      const line = await tx.inventoryCorporateLine.findUniqueOrThrow({
        where: { id: lineId },
        include: LINE_INCLUDE,
      })
      const linkChanged =
        before.currentHolderId !== line.currentHolderId ||
        before.equipmentId !== line.equipmentId ||
        before.simSlot !== line.simSlot
      const statusChanged = before.status !== line.status
      await tx.inventoryCorporateLineHistory.create({
        data: lineHistoryData(
          context,
          line.id,
          linkChanged ? 'LINK_UPDATED' : statusChanged ? 'STATUS_UPDATED' : 'UPDATED',
          origin,
          before,
          line,
        ),
      })
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_corporate_line_updated',
          entityType: 'InventoryCorporateLine',
          entityId: line.id,
          metadata: { origin, changes: lineAuditChanges(before, line) },
        },
        tx,
      )
      return line
    })
  } catch (error) {
    if (conflict(error)) throw new InventoryConflictError('Este número já está cadastrado neste portal.')
    throw error
  }
}

export async function archiveCorporateLine(context: InventoryContext, lineId: string, revision: number) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.inventoryCorporateLine.findFirst({
      where: { id: lineId, portalId: context.portalId, archivedAt: null },
      include: LINE_INCLUDE,
    })
    if (!before) throw new InventoryNotFoundError('Linha corporativa não encontrada.')
    const changed = await tx.inventoryCorporateLine.updateMany({
      where: { id: lineId, portalId: context.portalId, archivedAt: null, revision },
      data: { archivedAt: new Date(), revision: { increment: 1 } },
    })
    if (changed.count !== 1) {
      throw new InventoryConflictError('A linha foi alterada por outra pessoa. Recarregue e tente novamente.')
    }
    await tx.inventoryCorporateLineHistory.create({
      data: lineHistoryData(context, lineId, 'ARCHIVED', 'MANUAL', before, before),
    })
    await recordAuditEvent(
      {
        portalId: context.portalId,
        bitrixUserId: context.bitrixUserId,
        action: 'inventory_corporate_line_archived',
        entityType: 'InventoryCorporateLine',
        entityId: lineId,
      },
      tx,
    )
    return { id: lineId, archived: true }
  })
}

export function corporateLineEquipmentLabel(
  equipment: { patrimony: string | null; assetTag: string | null; name: string | null } | null,
): string | null {
  return equipmentName(equipment)
}

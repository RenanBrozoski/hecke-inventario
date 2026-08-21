import type { InventoryFieldType, Prisma, PrismaClient } from '@prisma/client'
import { Prisma as PrismaRuntime } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { recordAuditEvent } from '@/src/modules/audit/log'
import {
  InventoryConflictError,
  type InventoryContext,
  InventoryNotFoundError,
  InventoryValidationError,
} from './http'
import { lockInventoryResource, redactPasswordValues, validateDynamicData } from './service'

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>
type PageQuery = {
  page: number
  pageSize: number
  q?: string
  archived: 'exclude' | 'include' | 'only'
}

function page<T>(items: T[], total: number, query: PageQuery) {
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  }
}

function archiveWhere(portalId: string, archived: PageQuery['archived']) {
  return {
    portalId,
    ...(archived === 'exclude' ? { archivedAt: null } : {}),
    ...(archived === 'only' ? { archivedAt: { not: null } } : {}),
  }
}

function date(value: string | null | undefined): Date | null | undefined {
  return value === undefined
    ? undefined
    : value === null
      ? null
      : new Date(`${value}T00:00:00.000Z`)
}

function uniqueError(error: unknown): boolean {
  return error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === 'P2002'
}

async function audited<T>(
  context: InventoryContext,
  action: string,
  entityType: string,
  execute: (
    tx: TransactionClient,
  ) => Promise<{ entityId: string; value: T; metadata?: Record<string, unknown> }>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const result = await execute(tx)
    await recordAuditEvent(
      {
        portalId: context.portalId,
        bitrixUserId: context.bitrixUserId,
        action,
        entityType,
        entityId: result.entityId,
        metadata: result.metadata,
      },
      tx,
    )
    return result.value
  })
}

export async function listExtensions(portalId: string, query: PageQuery) {
  const where: Prisma.InventoryExtensionWhereInput = {
    ...archiveWhere(portalId, query.archived),
    ...(query.q
      ? {
          OR: [
            { number: { contains: query.q, mode: 'insensitive' } },
            { collaborator: { contains: query.q, mode: 'insensitive' } },
            { department: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  const [items, total] = await Promise.all([
    prisma.inventoryExtension.findMany({
      where,
      orderBy: [{ active: 'desc' }, { number: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.inventoryExtension.count({ where }),
  ])
  return page(items, total, query)
}

export async function getExtension(portalId: string, extensionId: string) {
  const record = await prisma.inventoryExtension.findFirst({ where: { id: extensionId, portalId } })
  if (!record) throw new InventoryNotFoundError('Ramal não encontrado.')
  return record
}

export async function createExtension(
  context: InventoryContext,
  input: {
    number?: string | null
    collaborator?: string | null
    department?: string | null
    type?: string | null
    active?: boolean
    notes?: string | null
  },
) {
  return audited(context, 'inventory_extension_created', 'InventoryExtension', async (tx) => {
    const record = await tx.inventoryExtension.create({
      data: { portalId: context.portalId, ...input },
    })
    return { entityId: record.id, value: record }
  })
}

export async function updateExtension(
  context: InventoryContext,
  extensionId: string,
  input: {
    number?: string | null
    collaborator?: string | null
    department?: string | null
    type?: string | null
    active?: boolean
    notes?: string | null
  },
) {
  return audited(context, 'inventory_extension_updated', 'InventoryExtension', async (tx) => {
    const exists = await tx.inventoryExtension.findFirst({
      where: { id: extensionId, portalId: context.portalId, archivedAt: null },
    })
    if (!exists) throw new InventoryNotFoundError('Ramal não encontrado.')
    const record = await tx.inventoryExtension.update({ where: { id: extensionId }, data: input })
    return { entityId: record.id, value: record, metadata: { changedFields: Object.keys(input) } }
  })
}

export async function archiveExtension(context: InventoryContext, extensionId: string) {
  return audited(context, 'inventory_extension_archived', 'InventoryExtension', async (tx) => {
    const exists = await tx.inventoryExtension.findFirst({
      where: { id: extensionId, portalId: context.portalId },
    })
    if (!exists) throw new InventoryNotFoundError('Ramal não encontrado.')
    await tx.inventoryExtension.update({
      where: { id: extensionId },
      data: { archivedAt: new Date(), active: false },
    })
    return { entityId: extensionId, value: { id: extensionId, archived: true } }
  })
}

export async function listReceivings(portalId: string, query: PageQuery) {
  const where: Prisma.InventoryReceivingWhereInput = {
    ...archiveWhere(portalId, query.archived),
    ...(query.q
      ? {
          OR: [
            { equipment: { contains: query.q, mode: 'insensitive' } },
            { tag: { contains: query.q, mode: 'insensitive' } },
            { deliveredTo: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  const [items, total] = await Promise.all([
    prisma.inventoryReceiving.findMany({
      where,
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.inventoryReceiving.count({ where }),
  ])
  return page(items, total, query)
}

export async function getReceiving(portalId: string, receivingId: string) {
  const record = await prisma.inventoryReceiving.findFirst({ where: { id: receivingId, portalId } })
  if (!record) throw new InventoryNotFoundError('Recebimento não encontrado.')
  return record
}

type ReceivingInput = {
  receivedAt?: string | null
  equipment?: string | null
  quantity?: number
  tag?: string | null
  deliveredAt?: string | null
  deliveredTo?: string | null
  notes?: string | null
}

export async function createReceiving(context: InventoryContext, input: ReceivingInput) {
  return audited(context, 'inventory_receiving_created', 'InventoryReceiving', async (tx) => {
    const record = await tx.inventoryReceiving.create({
      data: {
        ...input,
        portalId: context.portalId,
        receivedAt: date(input.receivedAt),
        deliveredAt: date(input.deliveredAt),
      },
    })
    return { entityId: record.id, value: record }
  })
}

export async function updateReceiving(
  context: InventoryContext,
  receivingId: string,
  input: ReceivingInput,
) {
  return audited(context, 'inventory_receiving_updated', 'InventoryReceiving', async (tx) => {
    const exists = await tx.inventoryReceiving.findFirst({
      where: { id: receivingId, portalId: context.portalId, archivedAt: null },
    })
    if (!exists) throw new InventoryNotFoundError('Recebimento não encontrado.')
    const record = await tx.inventoryReceiving.update({
      where: { id: receivingId },
      data: { ...input, receivedAt: date(input.receivedAt), deliveredAt: date(input.deliveredAt) },
    })
    return { entityId: record.id, value: record, metadata: { changedFields: Object.keys(input) } }
  })
}

export async function archiveReceiving(context: InventoryContext, receivingId: string) {
  return audited(context, 'inventory_receiving_archived', 'InventoryReceiving', async (tx) => {
    const exists = await tx.inventoryReceiving.findFirst({
      where: { id: receivingId, portalId: context.portalId },
    })
    if (!exists) throw new InventoryNotFoundError('Recebimento não encontrado.')
    await tx.inventoryReceiving.update({
      where: { id: receivingId },
      data: { archivedAt: new Date() },
    })
    return { entityId: receivingId, value: { id: receivingId, archived: true } }
  })
}

type TermInput = {
  type: 'DELIVERY' | 'RESPONSIBILITY' | 'RETURN'
  personId: string
  equipmentIds: string[]
  expectedRevisions: Record<string, number>
  observations?: string | null
}

async function getTermPerson(
  client: TransactionClient,
  portalId: string,
  personId: string | null | undefined,
) {
  if (!personId) return null
  const person = await client.inventoryPerson.findFirst({
    where: { id: personId, portalId, archivedAt: null },
    include: { department: { select: { name: true } } },
  })
  if (!person) throw new InventoryValidationError('Pessoa inválida para este portal.')
  return person
}

async function buildTermItems(
  client: TransactionClient,
  portalId: string,
  personId: string,
  equipmentIds: string[],
  expectedRevisions: Record<string, number>,
) {
  const orderedIds = [...equipmentIds].sort()
  await client.$queryRaw<Array<{ id: string }>>(PrismaRuntime.sql`
    SELECT "id"
    FROM "inventory_equipment"
    WHERE "portalId" = ${portalId}
      AND "id" IN (${PrismaRuntime.join(orderedIds)})
    ORDER BY "id"
    FOR UPDATE
  `)
  const equipment = await client.inventoryEquipment.findMany({
    where: {
      portalId,
      id: { in: equipmentIds },
      currentHolderId: personId,
      archivedAt: null,
    },
    include: { category: { include: { fields: true } } },
  })
  if (equipment.length !== equipmentIds.length) {
    throw new InventoryValidationError(
      'Um ou mais equipamentos não estão mais sob responsabilidade desta pessoa.',
    )
  }
  const byId = new Map(equipment.map((item) => [item.id, item]))
  return equipmentIds.map((equipmentId) => {
    const item = byId.get(equipmentId)!
    if (item.revision !== expectedRevisions[equipmentId]) {
      throw new InventoryConflictError(
        'Um ou mais equipamentos foram alterados. Recarregue antes de gerar o termo.',
      )
    }
    const sanitizedSpecs = redactPasswordValues(item.specs, item.category.fields)
    const visibleSpecs = item.category.fields
      .filter((field) => field.active && field.listVisible && field.type !== 'PASSWORD')
      .map((field) => ({
        key: field.key,
        label: field.label,
        value: sanitizedSpecs[field.key] ?? null,
      }))
    return {
      equipmentId: item.id,
      patrimony: item.patrimony,
      assetTag: item.assetTag,
      name: item.name,
      category: item.category.name,
      serialNumber: item.serialNumber,
      visibleSpecs,
    }
  })
}

export async function listTerms(portalId: string, query: PageQuery) {
  const where: Prisma.InventoryTermWhereInput = {
    ...archiveWhere(portalId, query.archived),
    ...(query.q
      ? {
          OR: [
            { personName: { contains: query.q, mode: 'insensitive' } },
            { destinationPersonName: { contains: query.q, mode: 'insensitive' } },
            { observations: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  const [items, total] = await Promise.all([
    prisma.inventoryTerm.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        person: { select: { id: true, name: true } },
        destinationPerson: { select: { id: true, name: true } },
      },
    }),
    prisma.inventoryTerm.count({ where }),
  ])
  return page(items, total, query)
}

export async function getTerm(portalId: string, termId: string) {
  const term = await prisma.inventoryTerm.findFirst({
    where: { id: termId, portalId },
    include: { person: true, destinationPerson: true },
  })
  if (!term) throw new InventoryNotFoundError('Termo não encontrado.')
  return term
}

export async function createTerm(context: InventoryContext, input: TermInput) {
  return audited(context, 'inventory_term_created', 'InventoryTerm', async (tx) => {
    const person = await getTermPerson(tx, context.portalId, input.personId)
    const items = await buildTermItems(
      tx,
      context.portalId,
      input.personId,
      input.equipmentIds,
      input.expectedRevisions,
    )
    const term = await tx.inventoryTerm.create({
      data: {
        portalId: context.portalId,
        type: input.type,
        personId: input.personId,
        personName: person?.name,
        personDepartmentName: person?.department?.name,
        items: items as Prisma.InputJsonValue,
        observations: input.observations,
        createdByBitrixUserId: context.bitrixUserId,
        createdByName: context.userName,
      },
    })
    return { entityId: term.id, value: term, metadata: { itemCount: items.length } }
  })
}

export async function archiveTerm(context: InventoryContext, termId: string) {
  return audited(context, 'inventory_term_archived', 'InventoryTerm', async (tx) => {
    const exists = await tx.inventoryTerm.findFirst({
      where: { id: termId, portalId: context.portalId },
    })
    if (!exists) throw new InventoryNotFoundError('Termo não encontrado.')
    await tx.inventoryTerm.update({ where: { id: termId }, data: { archivedAt: new Date() } })
    return { entityId: termId, value: { id: termId, archived: true } }
  })
}

type ModuleInput = {
  name?: string
  icon?: string
  description?: string | null
  titleLabel?: string
  sortOrder?: number
  active?: boolean
}

const MODULE_INCLUDE = {
  fields: { orderBy: [{ sortOrder: 'asc' as const }, { label: 'asc' as const }] },
  _count: { select: { records: true } },
} satisfies Prisma.InventoryCustomModuleInclude

export async function listCustomModules(portalId: string) {
  return prisma.inventoryCustomModule.findMany({
    where: { portalId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: MODULE_INCLUDE,
  })
}

export async function getCustomModule(portalId: string, moduleId: string) {
  const customModule = await prisma.inventoryCustomModule.findFirst({
    where: { id: moduleId, portalId, active: true },
    include: MODULE_INCLUDE,
  })
  if (!customModule) throw new InventoryNotFoundError('Módulo personalizado não encontrado.')
  return customModule
}

export async function createCustomModule(
  context: InventoryContext,
  input: ModuleInput & { name: string },
) {
  try {
    return await audited(
      context,
      'inventory_custom_module_created',
      'InventoryCustomModule',
      async (tx) => {
        const customModule = await tx.inventoryCustomModule.create({
          data: { portalId: context.portalId, ...input },
          include: MODULE_INCLUDE,
        })
        return { entityId: customModule.id, value: customModule }
      },
    )
  } catch (error) {
    if (uniqueError(error)) throw new InventoryConflictError('Já existe um módulo com este nome.')
    throw error
  }
}

export async function updateCustomModule(
  context: InventoryContext,
  moduleId: string,
  input: ModuleInput & { revision: number },
) {
  try {
    return await audited(
      context,
      'inventory_custom_module_updated',
      'InventoryCustomModule',
      async (tx) => {
        await lockInventoryResource(tx, context.portalId, 'custom-module', moduleId)
        const exists = await tx.inventoryCustomModule.findFirst({
          where: { id: moduleId, portalId: context.portalId, active: true },
        })
        if (!exists) throw new InventoryNotFoundError('Módulo personalizado não encontrado.')
        const { revision, ...data } = input
        const changed = await tx.inventoryCustomModule.updateMany({
          where: { id: moduleId, portalId: context.portalId, revision },
          data: { ...data, revision: { increment: 1 } },
        })
        if (changed.count !== 1)
          throw new InventoryConflictError('O módulo foi alterado por outra pessoa.')
        const customModule = await tx.inventoryCustomModule.findUniqueOrThrow({
          where: { id: moduleId },
          include: MODULE_INCLUDE,
        })
        return {
          entityId: customModule.id,
          value: customModule,
          metadata: { changedFields: Object.keys(data) },
        }
      },
    )
  } catch (error) {
    if (uniqueError(error)) throw new InventoryConflictError('Já existe um módulo com este nome.')
    throw error
  }
}

type ModuleFieldInput = {
  key?: string
  label?: string
  type?: InventoryFieldType
  options?: string[]
  sortOrder?: number
  required?: boolean
  listVisible?: boolean
  expiryAlert?: boolean
  active?: boolean
}

function hasStoredValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

export async function createCustomModuleField(
  context: InventoryContext,
  moduleId: string,
  input: ModuleFieldInput & { key: string; label: string },
) {
  try {
    return await audited(
      context,
      'inventory_custom_module_field_created',
      'InventoryCustomModuleField',
      async (tx) => {
        await lockInventoryResource(tx, context.portalId, 'custom-module', moduleId)
        const customModule = await tx.inventoryCustomModule.findFirst({
          where: { id: moduleId, portalId: context.portalId, active: true },
        })
        if (!customModule) throw new InventoryNotFoundError('Módulo personalizado não encontrado.')
        if (input.type === 'PASSWORD' && input.required) {
          throw new InventoryValidationError('Campos PASSWORD não podem ser obrigatórios.')
        }
        if (input.required) {
          const records = await tx.inventoryCustomRecord.count({
            where: { portalId: context.portalId, moduleId },
          })
          if (records > 0) {
            throw new InventoryConflictError(
              'Não é possível criar um campo obrigatório sem preencher os registros existentes.',
            )
          }
        }
        const field = await tx.inventoryCustomModuleField.create({
          data: {
            portalId: context.portalId,
            moduleId,
            ...input,
            ...(input.type !== undefined && input.type !== 'SELECT' ? { options: [] } : {}),
          },
        })
        await tx.inventoryCustomModule.update({
          where: { id: moduleId },
          data: { revision: { increment: 1 } },
        })
        return {
          entityId: field.id,
          value: field,
          metadata: { moduleId, key: input.key, type: input.type ?? 'TEXT' },
        }
      },
    )
  } catch (error) {
    if (uniqueError(error))
      throw new InventoryConflictError('Já existe um campo com esta chave no módulo.')
    throw error
  }
}

export async function updateCustomModuleField(
  context: InventoryContext,
  moduleId: string,
  fieldId: string,
  input: ModuleFieldInput,
) {
  try {
    return await audited(
      context,
      'inventory_custom_module_field_updated',
      'InventoryCustomModuleField',
      async (tx) => {
        await lockInventoryResource(tx, context.portalId, 'custom-module', moduleId)
        const existing = await tx.inventoryCustomModuleField.findFirst({
          where: { id: fieldId, moduleId, portalId: context.portalId },
        })
        if (!existing) throw new InventoryNotFoundError('Campo personalizado não encontrado.')
        const resultingType = input.type ?? existing.type
        const resultingRequired = input.required ?? existing.required
        if (resultingType === 'PASSWORD' && resultingRequired) {
          throw new InventoryValidationError('Campos PASSWORD não podem ser obrigatórios.')
        }
        const destructiveChange =
          (input.key !== undefined && input.key !== existing.key) ||
          (input.type !== undefined && input.type !== existing.type) ||
          (input.options !== undefined &&
            JSON.stringify(input.options) !== JSON.stringify(existing.options)) ||
          (input.active === false && existing.active)
        const enablingRequired = input.required === true && !existing.required
        if ((destructiveChange && input.type !== 'PASSWORD') || enablingRequired) {
          const records = await tx.inventoryCustomRecord.findMany({
            where: { portalId: context.portalId, moduleId },
            select: { data: true },
          })
          const hasValues = records.some((record) => {
            const data =
              record.data && typeof record.data === 'object' && !Array.isArray(record.data)
                ? (record.data as Record<string, unknown>)
                : {}
            return hasStoredValue(data[existing.key])
          })
          const hasMissingRequired = records.some((record) => {
            const data =
              record.data && typeof record.data === 'object' && !Array.isArray(record.data)
                ? (record.data as Record<string, unknown>)
                : {}
            return !hasStoredValue(data[existing.key])
          })
          if (
            (destructiveChange && input.type !== 'PASSWORD' && hasValues) ||
            (enablingRequired && hasMissingRequired)
          ) {
            throw new InventoryConflictError(
              enablingRequired && hasMissingRequired
                ? 'Preencha este campo em todos os registros antes de torná-lo obrigatório.'
                : 'Este campo possui valores. Limpe-os antes de alterar chave, tipo, opções ou ativação.',
            )
          }
        }
        if (existing.type === 'PASSWORD' || input.type === 'PASSWORD') {
          const records = await tx.inventoryCustomRecord.findMany({
            where: { portalId: context.portalId, moduleId },
            select: { id: true, data: true },
          })
          for (const record of records) {
            const data =
              record.data && typeof record.data === 'object' && !Array.isArray(record.data)
                ? { ...(record.data as Record<string, unknown>) }
                : {}
            if (Object.prototype.hasOwnProperty.call(data, existing.key)) {
              delete data[existing.key]
              await tx.inventoryCustomRecord.update({
                where: { id: record.id },
                data: { data: data as Prisma.InputJsonValue, revision: { increment: 1 } },
              })
            }
          }
        }
        const field = await tx.inventoryCustomModuleField.update({
          where: { id: fieldId },
          data: {
            ...input,
            ...(input.type !== undefined && input.type !== 'SELECT' ? { options: [] } : {}),
          },
        })
        await tx.inventoryCustomModule.update({
          where: { id: moduleId },
          data: { revision: { increment: 1 } },
        })
        return {
          entityId: field.id,
          value: field,
          metadata: { moduleId, changedFields: Object.keys(input) },
        }
      },
    )
  } catch (error) {
    if (uniqueError(error))
      throw new InventoryConflictError('Já existe um campo com esta chave no módulo.')
    throw error
  }
}

async function moduleWithFields(client: TransactionClient, portalId: string, moduleId: string) {
  await lockInventoryResource(client, portalId, 'custom-module', moduleId)
  const customModule = await client.inventoryCustomModule.findFirst({
    where: { id: moduleId, portalId, active: true },
    include: { fields: true },
  })
  if (!customModule) throw new InventoryNotFoundError('Módulo personalizado não encontrado.')
  return customModule
}

function safeRecord<T extends { data: unknown }>(
  record: T,
  fields: Array<{ key: string; type: InventoryFieldType }>,
) {
  return { ...record, data: redactPasswordValues(record.data, fields) }
}

export async function listCustomRecords(portalId: string, moduleId: string, query: PageQuery) {
  const customModule = await getCustomModule(portalId, moduleId)
  const where: Prisma.InventoryCustomRecordWhereInput = {
    ...archiveWhere(portalId, query.archived),
    moduleId,
    ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
  }
  const [records, total] = await Promise.all([
    prisma.inventoryCustomRecord.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.inventoryCustomRecord.count({ where }),
  ])
  return page(
    records.map((record) => safeRecord(record, customModule.fields)),
    total,
    query,
  )
}

export async function getCustomRecord(portalId: string, moduleId: string, recordId: string) {
  const customModule = await getCustomModule(portalId, moduleId)
  const record = await prisma.inventoryCustomRecord.findFirst({
    where: { id: recordId, moduleId, portalId, archivedAt: null },
  })
  if (!record) throw new InventoryNotFoundError('Registro personalizado não encontrado.')
  return safeRecord(record, customModule.fields)
}

export async function createCustomRecord(
  context: InventoryContext,
  moduleId: string,
  input: { title?: string | null; data?: Record<string, unknown> },
) {
  return audited(
    context,
    'inventory_custom_record_created',
    'InventoryCustomRecord',
    async (tx) => {
      const customModule = await moduleWithFields(tx, context.portalId, moduleId)
      const data = validateDynamicData(input.data ?? {}, customModule.fields)
      const record = await tx.inventoryCustomRecord.create({
        data: {
          portalId: context.portalId,
          moduleId,
          title: input.title,
          data: data as Prisma.InputJsonValue,
        },
      })
      return {
        entityId: record.id,
        value: safeRecord(record, customModule.fields),
        metadata: { moduleId },
      }
    },
  )
}

export async function updateCustomRecord(
  context: InventoryContext,
  moduleId: string,
  recordId: string,
  input: { revision: number; title?: string | null; data?: Record<string, unknown> },
) {
  return audited(
    context,
    'inventory_custom_record_updated',
    'InventoryCustomRecord',
    async (tx) => {
      const customModule = await moduleWithFields(tx, context.portalId, moduleId)
      const existing = await tx.inventoryCustomRecord.findFirst({
        where: { id: recordId, moduleId, portalId: context.portalId, archivedAt: null },
      })
      if (!existing) throw new InventoryNotFoundError('Registro personalizado não encontrado.')
      const data =
        input.data === undefined ? undefined : validateDynamicData(input.data, customModule.fields)
      const changed = await tx.inventoryCustomRecord.updateMany({
        where: {
          id: recordId,
          moduleId,
          portalId: context.portalId,
          archivedAt: null,
          revision: input.revision,
        },
        data: {
          title: input.title,
          ...(data !== undefined ? { data: data as Prisma.InputJsonValue } : {}),
          revision: { increment: 1 },
        },
      })
      if (changed.count !== 1)
        throw new InventoryConflictError('O registro foi alterado por outra pessoa.')
      const record = await tx.inventoryCustomRecord.findUniqueOrThrow({ where: { id: recordId } })
      return {
        entityId: record.id,
        value: safeRecord(record, customModule.fields),
        metadata: {
          moduleId,
          changedFields: Object.keys(input).filter((key) => key !== 'revision'),
        },
      }
    },
  )
}

export async function archiveCustomRecord(
  context: InventoryContext,
  moduleId: string,
  recordId: string,
) {
  return audited(
    context,
    'inventory_custom_record_archived',
    'InventoryCustomRecord',
    async (tx) => {
      const record = await tx.inventoryCustomRecord.findFirst({
        where: { id: recordId, moduleId, portalId: context.portalId },
      })
      if (!record) throw new InventoryNotFoundError('Registro personalizado não encontrado.')
      await tx.inventoryCustomRecord.update({
        where: { id: recordId },
        data: { archivedAt: new Date(), revision: { increment: 1 } },
      })
      return { entityId: recordId, value: { id: recordId, archived: true } }
    },
  )
}

import type { InventoryFieldType, Prisma, PrismaClient } from '@prisma/client'
import { Prisma as PrismaRuntime } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { recordAuditEvent } from '@/src/modules/audit/log'
import { inventoryTodayUtc } from './date'
import {
  InventoryConflictError,
  type InventoryContext,
  InventoryNotFoundError,
  InventoryValidationError,
} from './http'
import type {
  BulkTransferInput,
  CreateEquipmentInput,
  CreatePersonInput,
  TransferEquipmentInput,
  UpdateEquipmentInput,
  UpdatePersonInput,
} from './schemas'

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>
type JsonRecord = Record<string, unknown>
export type DynamicField = {
  key: string
  label: string
  type: InventoryFieldType
  options: string[]
  required: boolean
  active: boolean
}

const EQUIPMENT_INCLUDE = {
  category: {
    include: { fields: { orderBy: [{ sortOrder: 'asc' as const }, { label: 'asc' as const }] } },
  },
  currentHolder: { select: { id: true, name: true, status: true } },
  department: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
} satisfies Prisma.InventoryEquipmentInclude

function parseDateOnly(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return new Date(`${value}T00:00:00.000Z`)
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === 'P2002'
}

export async function lockInventoryResource(
  client: TransactionClient,
  portalId: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await client.$queryRaw<Array<{ lock: string | null }>>(PrismaRuntime.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`inventory-resource:${portalId}:${resourceType}:${resourceId}`}, 0)
    )::text AS "lock"
  `)
}

async function lockInventoryPerson(
  client: TransactionClient,
  portalId: string,
  personId: string,
): Promise<void> {
  await lockInventoryResource(client, portalId, 'person', personId)
}

function paginated<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
}

function asJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function isValueEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function isValidFieldValue(field: DynamicField, value: unknown): boolean {
  if (value === null) return !field.required
  switch (field.type) {
    case 'TEXT':
    case 'TEXTAREA':
      return typeof value === 'string' && value.length <= 10_000
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value)
    case 'DATE': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
      const parsed = new Date(`${value}T00:00:00.000Z`)
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    }
    case 'SELECT':
      return (
        typeof value === 'string' && (field.options.length === 0 || field.options.includes(value))
      )
    case 'BOOLEAN':
      return typeof value === 'boolean'
    case 'MAC':
      return typeof value === 'string' && /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(value)
    case 'IP':
      return (
        typeof value === 'string' &&
        /^([0-9]{1,3}\.){3}[0-9]{1,3}$/.test(value) &&
        value.split('.').every((part) => Number(part) <= 255)
      )
    case 'PASSWORD':
      return false
  }
}

/** Valida dados dinâmicos e impede persistência de campos PASSWORD. */
export function validateDynamicData(data: unknown, fields: DynamicField[]): JsonRecord {
  const record = asJsonRecord(data)
  const definitions = new Map(
    fields.filter((field) => field.active).map((field) => [field.key, field]),
  )
  const errors: Array<{ path: string; message: string }> = []

  for (const key of Object.keys(record)) {
    const field = definitions.get(key)
    if (!field) {
      errors.push({ path: key, message: 'Campo inexistente ou inativo.' })
      continue
    }
    if (field.type === 'PASSWORD') {
      errors.push({ path: key, message: 'Campos PASSWORD não podem ser armazenados.' })
      continue
    }
    if (!isValidFieldValue(field, record[key])) {
      errors.push({ path: key, message: `Valor inválido para o campo ${field.label}.` })
    }
  }

  for (const field of definitions.values()) {
    if (field.type !== 'PASSWORD' && field.required && isValueEmpty(record[field.key])) {
      errors.push({ path: field.key, message: `O campo ${field.label} é obrigatório.` })
    }
  }

  if (errors.length > 0)
    throw new InventoryValidationError('Dados dos campos personalizados inválidos.', errors)
  return record
}

/** Defesa em profundidade para dados legados: PASSWORD nunca sai pela API. */
export function redactPasswordValues(
  data: unknown,
  fields: Pick<DynamicField, 'key' | 'type'>[],
): JsonRecord {
  const record = { ...asJsonRecord(data) }
  for (const field of fields) {
    if (field.type === 'PASSWORD') delete record[field.key]
  }
  return record
}

function safeEquipment<
  T extends {
    specs: unknown
    legacyInvalidSpecs?: unknown
    category: { fields: DynamicField[] }
  },
>(equipment: T) {
  return {
    ...equipment,
    specs: redactPasswordValues(equipment.specs, equipment.category.fields),
    ...(Object.prototype.hasOwnProperty.call(equipment, 'legacyInvalidSpecs')
      ? {
          legacyInvalidSpecs: redactPasswordValues(
            equipment.legacyInvalidSpecs,
            equipment.category.fields,
          ),
        }
      : {}),
  }
}

async function ensureDepartment(
  client: TransactionClient,
  portalId: string,
  departmentId: string | null | undefined,
) {
  if (!departmentId) return null
  await lockInventoryResource(client, portalId, 'department', departmentId)
  const department = await client.inventoryDepartment.findFirst({
    where: { id: departmentId, portalId, active: true },
  })
  if (!department) throw new InventoryValidationError('Setor inválido para este portal.')
  return department
}

async function ensureLocation(
  client: TransactionClient,
  portalId: string,
  locationId: string | null | undefined,
) {
  if (!locationId) return null
  await lockInventoryResource(client, portalId, 'location', locationId)
  const location = await client.inventoryLocation.findFirst({
    where: { id: locationId, portalId, active: true },
  })
  if (!location) throw new InventoryValidationError('Local inválido para este portal.')
  return location
}

async function ensurePerson(
  client: TransactionClient,
  portalId: string,
  personId: string | null | undefined,
) {
  if (!personId) return null
  await lockInventoryPerson(client, portalId, personId)
  const person = await client.inventoryPerson.findFirst({
    where: { id: personId, portalId, archivedAt: null, status: { not: 'TERMINATED' } },
  })
  if (!person) throw new InventoryValidationError('Pessoa inválida para este portal.')
  return person
}

async function ensureCategory(client: TransactionClient, portalId: string, categoryId: string) {
  await lockInventoryResource(client, portalId, 'category', categoryId)
  const category = await client.inventoryCategory.findFirst({
    where: { id: categoryId, portalId, active: true },
    include: { fields: true },
  })
  if (!category) throw new InventoryValidationError('Categoria inválida para este portal.')
  return category
}

export async function getInventoryDashboard(portalId: string) {
  const today = inventoryTodayUtc()
  const inThirtyDays = new Date(today)
  inThirtyDays.setUTCDate(inThirtyDays.getUTCDate() + 30)
  const [
    equipmentTotal,
    peopleTotal,
    activePeople,
    departments,
    locations,
    extensions,
    receivings,
    categories,
    withoutHolder,
    expired,
    expiringSoon,
    byStatus,
    byCategory,
    recentMovements,
  ] = await Promise.all([
    prisma.inventoryEquipment.count({ where: { portalId, archivedAt: null } }),
    prisma.inventoryPerson.count({ where: { portalId, archivedAt: null } }),
    prisma.inventoryPerson.count({ where: { portalId, archivedAt: null, status: 'ACTIVE' } }),
    prisma.inventoryDepartment.count({ where: { portalId, active: true } }),
    prisma.inventoryLocation.count({ where: { portalId, active: true } }),
    prisma.inventoryExtension.count({ where: { portalId, archivedAt: null, active: true } }),
    prisma.inventoryReceiving.count({ where: { portalId, archivedAt: null } }),
    prisma.inventoryCategory.count({ where: { portalId, active: true } }),
    prisma.inventoryEquipment.count({
      where: { portalId, archivedAt: null, currentHolderId: null },
    }),
    prisma.inventoryEquipment.count({
      where: { portalId, archivedAt: null, warrantyEndsAt: { lt: today } },
    }),
    prisma.inventoryEquipment.count({
      where: { portalId, archivedAt: null, warrantyEndsAt: { gte: today, lte: inThirtyDays } },
    }),
    prisma.inventoryEquipment.groupBy({
      by: ['status'],
      where: { portalId, archivedAt: null },
      _count: { _all: true },
    }),
    prisma.inventoryCategory.findMany({
      where: { portalId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        _count: { select: { equipment: { where: { archivedAt: null } } } },
      },
    }),
    prisma.inventoryMovement.findMany({
      where: { portalId },
      orderBy: [{ movedAt: 'desc' }, { createdAt: 'desc' }],
      take: 10,
      include: { equipment: { select: { id: true, patrimony: true, assetTag: true, name: true } } },
    }),
  ])

  return {
    counts: {
      equipment: equipmentTotal,
      people: peopleTotal,
      activePeople,
      departments,
      locations,
      extensions,
      receivings,
      categories,
      withoutHolder,
      expired,
      expiringSoon,
    },
    equipmentByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    equipmentByCategory: byCategory.map((category) => ({
      id: category.id,
      name: category.name,
      count: category._count.equipment,
    })),
    recentMovements,
  }
}

export async function getInventoryLookups(portalId: string) {
  const [categories, departments, locations, people] = await Promise.all([
    prisma.inventoryCategory.findMany({
      where: { portalId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        fields: { where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] },
      },
    }),
    prisma.inventoryDepartment.findMany({
      where: { portalId, active: true },
      orderBy: { name: 'asc' },
    }),
    prisma.inventoryLocation.findMany({
      where: { portalId, active: true },
      orderBy: { name: 'asc' },
    }),
    prisma.inventoryPerson.findMany({
      where: { portalId, archivedAt: null, status: { not: 'TERMINATED' } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, departmentId: true, status: true },
    }),
  ])
  return { categories, departments, locations, people }
}

export async function listEquipment(
  portalId: string,
  query: {
    page: number
    pageSize: number
    q?: string
    status?: Prisma.EnumInventoryEquipmentStatusFilter['equals']
    categoryId?: string
    categoryIds?: string[]
    holderId?: string
    departmentId?: string
    locationId?: string
    archived: 'exclude' | 'include' | 'only'
    sort?: string
    dir?: 'asc' | 'desc'
  },
) {
  // Prisma não oferece busca textual em todas as chaves de um JSONB sem
  // conhecer o path. Recuperamos somente IDs do mesmo portal com SQL
  // parametrizado e reaplicamos todos os filtros/escopo na consulta principal.
  // O volume deste domínio é deliberadamente pequeno (inventário interno).
  const specificationMatches = query.q
    ? await prisma.$queryRaw<Array<{ id: string }>>(PrismaRuntime.sql`
        SELECT equipment."id"
        FROM "inventory_equipment" AS equipment
        WHERE equipment."portalId" = ${portalId}
          AND (
            equipment."specs" - ARRAY(
              SELECT field."key"
              FROM "inventory_fields" AS field
              WHERE field."portalId" = ${portalId}
                AND field."categoryId" = equipment."categoryId"
                AND field."type" = 'PASSWORD'::"InventoryFieldType"
            )
          )::text ILIKE ${`%${query.q.replace(/[\\%_]/g, '\\$&')}%`} ESCAPE '\\'
      `)
    : []
  const specificationIds = specificationMatches.map((item) => item.id)
  const where: Prisma.InventoryEquipmentWhereInput = {
    portalId,
    ...(query.archived === 'exclude' ? { archivedAt: null } : {}),
    ...(query.archived === 'only' ? { archivedAt: { not: null } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.categoryIds?.length
      ? { categoryId: { in: query.categoryIds } }
      : query.categoryId
        ? { categoryId: query.categoryId }
        : {}),
    ...(query.holderId ? { currentHolderId: query.holderId } : {}),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.q
      ? {
          OR: [
            { patrimony: { contains: query.q, mode: 'insensitive' } },
            { assetTag: { contains: query.q, mode: 'insensitive' } },
            { name: { contains: query.q, mode: 'insensitive' } },
            { serialNumber: { contains: query.q, mode: 'insensitive' } },
            { currentHolder: { name: { contains: query.q, mode: 'insensitive' } } },
            ...(specificationIds.length > 0 ? [{ id: { in: specificationIds } }] : []),
          ],
        }
      : {}),
  }
  const dir = query.dir ?? 'desc'
  const sortField = query.sort ?? 'updatedAt'
  const orderBy: Prisma.InventoryEquipmentOrderByWithRelationInput[] = (() => {
    switch (sortField) {
      case 'patrimony':
        return [{ patrimony: dir }, { id: 'asc' }]
      case 'name':
        return [{ name: dir }, { id: 'asc' }]
      case 'category':
        return [{ category: { name: dir } }, { id: 'asc' }]
      case 'status':
        return [{ status: dir }, { id: 'asc' }]
      case 'holder':
        return [{ currentHolder: { name: dir } }, { id: 'asc' }]
      case 'department':
        return [{ department: { name: dir } }, { id: 'asc' }]
      case 'location':
        return [{ location: { name: dir } }, { id: 'asc' }]
      case 'createdAt':
        return [{ createdAt: dir }, { id: 'asc' }]
      default:
        return [{ updatedAt: dir }, { id: 'asc' }]
    }
  })()

  const [items, total] = await Promise.all([
    prisma.inventoryEquipment.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: EQUIPMENT_INCLUDE,
    }),
    prisma.inventoryEquipment.count({ where }),
  ])
  return paginated(items.map(safeEquipment), total, query.page, query.pageSize)
}

export async function getEquipment(portalId: string, equipmentId: string) {
  const equipment = await prisma.inventoryEquipment.findFirst({
    where: { id: equipmentId, portalId },
    include: {
      ...EQUIPMENT_INCLUDE,
      movements: {
        orderBy: [{ movedAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          fromPerson: { select: { id: true, name: true } },
          toPerson: { select: { id: true, name: true } },
          fromDepartment: { select: { id: true, name: true } },
          toDepartment: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!equipment) throw new InventoryNotFoundError('Equipamento não encontrado.')
  return safeEquipment(equipment)
}

export async function createEquipment(
  context: InventoryContext,
  input: CreateEquipmentInput,
  origin: 'MANUAL' | 'IMPORT' = 'MANUAL',
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const category = await ensureCategory(tx, context.portalId, input.categoryId)
      await Promise.all([
        ensurePerson(tx, context.portalId, input.currentHolderId),
        ensureDepartment(tx, context.portalId, input.departmentId),
        ensureLocation(tx, context.portalId, input.locationId),
      ])
      const specs = validateDynamicData(input.specs ?? {}, category.fields)
      const equipment = await tx.inventoryEquipment.create({
        data: {
          portalId: context.portalId,
          patrimony: input.patrimony,
          assetTag: input.assetTag,
          name: input.name,
          categoryId: input.categoryId,
          status: input.status,
          currentHolderId: input.currentHolderId,
          departmentId: input.departmentId,
          locationId: input.locationId,
          locationDetail: input.locationDetail,
          serialNumber: input.serialNumber,
          invoiceNumber: input.invoiceNumber,
          acquiredAt: parseDateOnly(input.acquiredAt),
          receivedAt: parseDateOnly(input.receivedAt),
          deliveredAt: parseDateOnly(input.deliveredAt),
          warrantyEndsAt: parseDateOnly(input.warrantyEndsAt),
          specs: specs as Prisma.InputJsonValue,
          notes: input.notes,
        },
        include: EQUIPMENT_INCLUDE,
      })
      if (input.currentHolderId || input.departmentId) {
        const person = await ensurePerson(tx, context.portalId, input.currentHolderId)
        const department = await ensureDepartment(tx, context.portalId, input.departmentId)
        await tx.inventoryMovement.create({
          data: {
            portalId: context.portalId,
            equipmentId: equipment.id,
            toPersonId: person?.id,
            toPersonName: person?.name,
            toDepartmentId: department?.id,
            toDepartmentName: department?.name,
            movedAt: inventoryTodayUtc(),
            origin: origin === 'IMPORT' ? 'IMPORT' : 'INITIAL_REGISTRATION',
            performedByBitrixUserId: context.bitrixUserId,
            performedByName: context.userName,
          },
        })
      }
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_equipment_created',
          entityType: 'InventoryEquipment',
          entityId: equipment.id,
          metadata: { origin, categoryId: input.categoryId },
        },
        tx,
      )
      return safeEquipment(equipment)
    })
  } catch (error) {
    if (isUniqueConstraintError(error))
      throw new InventoryConflictError('Patrimônio já cadastrado neste portal.')
    throw error
  }
}

export async function updateEquipment(
  context: InventoryContext,
  equipmentId: string,
  input: UpdateEquipmentInput,
  origin: 'MANUAL' | 'IMPORT' = 'MANUAL',
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.inventoryEquipment.findFirst({
        where: { id: equipmentId, portalId: context.portalId, archivedAt: null },
        include: EQUIPMENT_INCLUDE,
      })
      if (!current) throw new InventoryNotFoundError('Equipamento não encontrado.')

      const category = await ensureCategory(
        tx,
        context.portalId,
        input.categoryId ?? current.categoryId,
      )
      const holderProvided = Object.prototype.hasOwnProperty.call(input, 'currentHolderId')
      const departmentProvided = Object.prototype.hasOwnProperty.call(input, 'departmentId')
      const [destinationPerson, destinationDepartment] = await Promise.all([
        holderProvided
          ? ensurePerson(tx, context.portalId, input.currentHolderId)
          : Promise.resolve(undefined),
        departmentProvided
          ? ensureDepartment(tx, context.portalId, input.departmentId)
          : Promise.resolve(undefined),
        ensureLocation(tx, context.portalId, input.locationId),
      ])
      const specs =
        input.specs !== undefined
          ? validateDynamicData(input.specs, category.fields)
          : input.categoryId !== undefined && input.categoryId !== current.categoryId
            ? validateDynamicData(
                redactPasswordValues(current.specs, current.category.fields),
                category.fields,
              )
            : undefined
      const legacyInvalidSpecs = redactPasswordValues(
        current.legacyInvalidSpecs,
        current.category.fields,
      )
      if (specs !== undefined) {
        // O formulário envia o conjunto de campos revisado. Qualquer chave
        // presente deixa de pertencer à quarentena, inclusive quando o usuário
        // optou por limpá-la.
        for (const key of Object.keys(specs)) delete legacyInvalidSpecs[key]
      }
      const changedFields = Object.keys(input).filter((key) => key !== 'revision')
      const data: Prisma.InventoryEquipmentUncheckedUpdateManyInput = {
        patrimony: input.patrimony,
        assetTag: input.assetTag,
        name: input.name,
        categoryId: input.categoryId,
        status: input.status,
        currentHolderId: input.currentHolderId,
        departmentId: input.departmentId,
        locationId: input.locationId,
        locationDetail: input.locationDetail,
        serialNumber: input.serialNumber,
        invoiceNumber: input.invoiceNumber,
        acquiredAt: parseDateOnly(input.acquiredAt),
        receivedAt: parseDateOnly(input.receivedAt),
        deliveredAt: parseDateOnly(input.deliveredAt),
        warrantyEndsAt: parseDateOnly(input.warrantyEndsAt),
        ...(specs !== undefined
          ? {
              specs: specs as Prisma.InputJsonValue,
              legacyInvalidSpecs: legacyInvalidSpecs as Prisma.InputJsonValue,
            }
          : {}),
        notes: input.notes,
        revision: { increment: 1 },
      }
      const updated = await tx.inventoryEquipment.updateMany({
        where: {
          id: equipmentId,
          portalId: context.portalId,
          archivedAt: null,
          revision: input.revision,
        },
        data,
      })
      if (updated.count !== 1)
        throw new InventoryConflictError(
          'O equipamento foi alterado por outra pessoa. Recarregue e tente novamente.',
        )
      const holderChanged =
        holderProvided && (input.currentHolderId ?? null) !== current.currentHolderId
      const departmentChanged =
        departmentProvided && (input.departmentId ?? null) !== current.departmentId
      let movementId: string | null = null
      if (holderChanged || departmentChanged) {
        const movement = await tx.inventoryMovement.create({
          data: {
            portalId: context.portalId,
            equipmentId,
            fromPersonId: current.currentHolderId,
            fromPersonName: current.currentHolder?.name,
            toPersonId: holderProvided ? (input.currentHolderId ?? null) : current.currentHolderId,
            toPersonName: holderProvided
              ? (destinationPerson?.name ?? null)
              : current.currentHolder?.name,
            fromDepartmentId: current.departmentId,
            fromDepartmentName: current.department?.name,
            toDepartmentId: departmentProvided
              ? (input.departmentId ?? null)
              : current.departmentId,
            toDepartmentName: departmentProvided
              ? (destinationDepartment?.name ?? null)
              : current.department?.name,
            movedAt: inventoryTodayUtc(),
            origin,
            performedByBitrixUserId: context.bitrixUserId,
            performedByName: context.userName,
          },
        })
        movementId = movement.id
      }
      const result = await tx.inventoryEquipment.findUniqueOrThrow({
        where: { id: equipmentId },
        include: EQUIPMENT_INCLUDE,
      })
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_equipment_updated',
          entityType: 'InventoryEquipment',
          entityId: equipmentId,
          metadata: { origin, changedFields, movementId },
        },
        tx,
      )
      return safeEquipment(result)
    })
  } catch (error) {
    if (isUniqueConstraintError(error))
      throw new InventoryConflictError('Patrimônio já cadastrado neste portal.')
    throw error
  }
}

export async function transferEquipment(
  context: InventoryContext,
  equipmentId: string,
  input: TransferEquipmentInput,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.inventoryEquipment.findFirst({
      where: { id: equipmentId, portalId: context.portalId, archivedAt: null },
      include: EQUIPMENT_INCLUDE,
    })
    if (!current) throw new InventoryNotFoundError('Equipamento não encontrado.')
    if (current.revision !== input.revision) {
      throw new InventoryConflictError(
        'O equipamento foi alterado por outra pessoa. Recarregue e tente novamente.',
      )
    }

    const personProvided = Object.prototype.hasOwnProperty.call(input, 'toPersonId')
    const departmentProvided = Object.prototype.hasOwnProperty.call(input, 'toDepartmentId')
    const locationProvided = Object.prototype.hasOwnProperty.call(input, 'locationId')
    const destinationPerson = personProvided
      ? await ensurePerson(tx, context.portalId, input.toPersonId)
      : undefined
    const destinationDepartment =
      departmentProvided && input.toDepartmentId
        ? await ensureDepartment(tx, context.portalId, input.toDepartmentId)
        : undefined
    if (locationProvided) await ensureLocation(tx, context.portalId, input.locationId)

    const toPersonId = personProvided ? (input.toPersonId ?? null) : current.currentHolderId
    const toDepartmentId = departmentProvided
      ? (input.toDepartmentId ?? null)
      : current.departmentId
    const holderChanged = toPersonId !== current.currentHolderId
    const departmentChanged = toDepartmentId !== current.departmentId
    const locationChanged = locationProvided && (input.locationId ?? null) !== current.locationId
    const statusChanged = input.status !== undefined && input.status !== current.status

    if (!holderChanged && !departmentChanged && !locationChanged && !statusChanged) {
      return { equipment: safeEquipment(current), movement: null, changed: false }
    }

    const updated = await tx.inventoryEquipment.updateMany({
      where: {
        id: equipmentId,
        portalId: context.portalId,
        archivedAt: null,
        revision: input.revision,
      },
      data: {
        ...(personProvided ? { currentHolderId: toPersonId } : {}),
        ...(departmentProvided ? { departmentId: toDepartmentId } : {}),
        ...(locationProvided ? { locationId: input.locationId ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        revision: { increment: 1 },
      },
    })
    if (updated.count !== 1)
      throw new InventoryConflictError(
        'O equipamento foi alterado por outra pessoa. Recarregue e tente novamente.',
      )

    let movement = null
    if (holderChanged || departmentChanged) {
      movement = await tx.inventoryMovement.create({
        data: {
          portalId: context.portalId,
          equipmentId,
          fromPersonId: current.currentHolderId,
          fromPersonName: current.currentHolder?.name,
          toPersonId,
          toPersonName:
            destinationPerson?.name ??
            (toPersonId === current.currentHolderId ? current.currentHolder?.name : null),
          fromDepartmentId: current.departmentId,
          fromDepartmentName: current.department?.name,
          toDepartmentId,
          toDepartmentName:
            destinationDepartment?.name ??
            (toDepartmentId === current.departmentId ? current.department?.name : null),
          movedAt: parseDateOnly(input.movedAt) ?? inventoryTodayUtc(),
          reason: input.reason,
          origin: input.origin,
          performedByBitrixUserId: context.bitrixUserId,
          performedByName: context.userName,
        },
      })
    }

    const equipment = await tx.inventoryEquipment.findUniqueOrThrow({
      where: { id: equipmentId },
      include: EQUIPMENT_INCLUDE,
    })
    await recordAuditEvent(
      {
        portalId: context.portalId,
        bitrixUserId: context.bitrixUserId,
        action: 'inventory_equipment_transferred',
        entityType: 'InventoryEquipment',
        entityId: equipmentId,
        metadata: {
          holderChanged,
          departmentChanged,
          locationChanged,
          statusChanged,
          movementId: movement?.id ?? null,
        },
      },
      tx,
    )
    return { equipment: safeEquipment(equipment), movement, changed: true }
  })
}

/**
 * Transfere um conjunto fechado de equipamentos atualmente sob a pessoa de
 * origem. O lote é all-or-nothing: primeiro todos os compare-and-swap de
 * revision precisam vencer; só então movimentos, termo e auditoria são
 * anexados, ainda na mesma transação.
 */
export async function bulkTransferEquipment(
  context: InventoryContext,
  sourcePersonId: string,
  input: BulkTransferInput,
) {
  return prisma.$transaction(
    async (tx) => {
      const peopleToLock = [sourcePersonId, input.destinationPersonId]
        .filter((personId): personId is string => personId !== null)
        .filter((personId, index, values) => values.indexOf(personId) === index)
        .sort()
      for (const personId of peopleToLock) {
        await lockInventoryPerson(tx, context.portalId, personId)
      }
      const sourcePerson = await tx.inventoryPerson.findFirst({
        where: { id: sourcePersonId, portalId: context.portalId, archivedAt: null },
        include: { department: { select: { id: true, name: true } } },
      })
      if (!sourcePerson) throw new InventoryNotFoundError('Pessoa de origem não encontrada.')
      if (input.destinationPersonId === sourcePersonId) {
        throw new InventoryValidationError('A pessoa de destino deve ser diferente da origem.')
      }

      const destinationPerson = input.destinationPersonId
        ? await tx.inventoryPerson.findFirst({
            where: {
              id: input.destinationPersonId,
              portalId: context.portalId,
              archivedAt: null,
              status: { not: 'TERMINATED' },
            },
            include: { department: { select: { id: true, name: true } } },
          })
        : null
      if (input.destinationPersonId && !destinationPerson) {
        throw new InventoryValidationError('Pessoa de destino inválida para este portal.')
      }
      if (destinationPerson?.departmentId) {
        await ensureDepartment(tx, context.portalId, destinationPerson.departmentId)
      }

      const selected = await tx.inventoryEquipment.findMany({
        where: {
          id: { in: input.equipmentIds },
          portalId: context.portalId,
          currentHolderId: sourcePersonId,
          archivedAt: null,
        },
        include: {
          category: { include: { fields: true } },
          department: { select: { id: true, name: true } },
        },
      })
      if (selected.length !== input.equipmentIds.length) {
        throw new InventoryConflictError(
          'A seleção não corresponde mais aos equipamentos atuais desta pessoa. Recarregue e tente novamente.',
        )
      }

      const byId = new Map(selected.map((equipment) => [equipment.id, equipment]))
      const equipment = input.equipmentIds.map((equipmentId) => byId.get(equipmentId)!)
      for (const item of equipment) {
        if (item.revision !== input.expectedRevisions[item.id]) {
          throw new InventoryConflictError(
            'Um ou mais equipamentos foram alterados por outra pessoa. Recarregue e tente novamente.',
          )
        }
      }

      // Fase CAS. Nenhum evento é anexado antes de todos os updates vencerem.
      for (const item of equipment) {
        const changed = await tx.inventoryEquipment.updateMany({
          where: {
            id: item.id,
            portalId: context.portalId,
            currentHolderId: sourcePersonId,
            archivedAt: null,
            revision: input.expectedRevisions[item.id],
          },
          data: {
            currentHolderId: destinationPerson?.id ?? null,
            // Ao devolver ao estoque, o setor legado permanece. Quando há
            // destino, o setor canônico passa a ser o setor atual do destino.
            ...(destinationPerson ? { departmentId: destinationPerson.departmentId } : {}),
            revision: { increment: 1 },
          },
        })
        if (changed.count !== 1) {
          throw new InventoryConflictError(
            'Um ou mais equipamentos foram alterados por outra pessoa. Recarregue e tente novamente.',
          )
        }
      }

      const movedAt = parseDateOnly(input.movedAt)!
      const movements = []
      const itemSnapshots = equipment.map((item) => {
        const specs = redactPasswordValues(item.specs, item.category.fields)
        return {
          equipmentId: item.id,
          patrimony: item.patrimony,
          assetTag: item.assetTag,
          name: item.name,
          category: item.category.name,
          serialNumber: item.serialNumber,
          status: item.status,
          departmentId: item.departmentId,
          departmentName: item.department?.name ?? null,
          revisionBefore: item.revision,
          visibleSpecs: item.category.fields
            .filter((field) => field.active && field.listVisible && field.type !== 'PASSWORD')
            .map((field) => ({
              key: field.key,
              label: field.label,
              value: specs[field.key] ?? null,
            })),
        }
      })

      for (const item of equipment) {
        const destinationDepartment = destinationPerson
          ? destinationPerson.department
          : item.department
        movements.push(
          await tx.inventoryMovement.create({
            data: {
              portalId: context.portalId,
              equipmentId: item.id,
              fromPersonId: sourcePerson.id,
              fromPersonName: sourcePerson.name,
              toPersonId: destinationPerson?.id ?? null,
              toPersonName: destinationPerson?.name ?? null,
              fromDepartmentId: item.departmentId,
              fromDepartmentName: item.department?.name ?? null,
              toDepartmentId: destinationPerson
                ? destinationPerson.departmentId
                : item.departmentId,
              toDepartmentName: destinationDepartment?.name ?? null,
              movedAt,
              reason: input.reason,
              origin: 'BULK_TRANSFER',
              performedByBitrixUserId: context.bitrixUserId,
              performedByName: context.userName,
            },
          }),
        )
      }

      const term = input.createTerm
        ? await tx.inventoryTerm.create({
            data: {
              portalId: context.portalId,
              type: 'TRANSFER',
              personId: sourcePerson.id,
              personName: sourcePerson.name,
              personDepartmentName: sourcePerson.department?.name ?? null,
              destinationPersonId: destinationPerson?.id ?? null,
              destinationPersonName: destinationPerson?.name ?? null,
              destinationDepartmentName: destinationPerson?.department?.name ?? null,
              items: itemSnapshots as Prisma.InputJsonValue,
              observations: input.reason,
              createdByBitrixUserId: context.bitrixUserId,
              createdByName: context.userName,
            },
          })
        : null

      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_bulk_transfer_completed',
          entityType: 'InventoryPerson',
          entityId: sourcePerson.id,
          metadata: {
            transferredCount: equipment.length,
            destinationPersonId: destinationPerson?.id ?? null,
            movementCount: movements.length,
            termId: term?.id ?? null,
          },
        },
        tx,
      )

      return {
        transferredCount: equipment.length,
        equipmentIds: input.equipmentIds,
        movements,
        term,
      }
    },
    { timeout: 30_000 },
  )
}

export async function archiveEquipment(
  context: InventoryContext,
  equipmentId: string,
  revision: number,
) {
  return prisma.$transaction(async (tx) => {
    const exists = await tx.inventoryEquipment.findFirst({
      where: { id: equipmentId, portalId: context.portalId },
    })
    if (!exists) throw new InventoryNotFoundError('Equipamento não encontrado.')
    const result = await tx.inventoryEquipment.updateMany({
      where: { id: equipmentId, portalId: context.portalId, revision },
      data: { archivedAt: new Date(), revision: { increment: 1 } },
    })
    if (result.count !== 1)
      throw new InventoryConflictError(
        'O equipamento foi alterado por outra pessoa. Recarregue e tente novamente.',
      )
    await recordAuditEvent(
      {
        portalId: context.portalId,
        bitrixUserId: context.bitrixUserId,
        action: 'inventory_equipment_archived',
        entityType: 'InventoryEquipment',
        entityId: equipmentId,
      },
      tx,
    )
    return { id: equipmentId, archived: true }
  })
}

export async function listPeople(
  portalId: string,
  query: {
    page: number
    pageSize: number
    q?: string
    status?: Prisma.EnumInventoryPersonStatusFilter['equals']
    departmentId?: string
    archived: 'exclude' | 'include' | 'only'
  },
) {
  const where: Prisma.InventoryPersonWhereInput = {
    portalId,
    ...(query.archived === 'exclude' ? { archivedAt: null } : {}),
    ...(query.archived === 'only' ? { archivedAt: { not: null } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { email: { contains: query.q, mode: 'insensitive' } },
            { employeeNumber: { contains: query.q, mode: 'insensitive' } },
            { title: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  const [items, total] = await Promise.all([
    prisma.inventoryPerson.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        department: { select: { id: true, name: true } },
        _count: { select: { equipment: true } },
      },
    }),
    prisma.inventoryPerson.count({ where }),
  ])
  return paginated(items, total, query.page, query.pageSize)
}

export async function getPerson(portalId: string, personId: string) {
  const person = await prisma.inventoryPerson.findFirst({
    where: { id: personId, portalId },
    include: {
      department: true,
      equipment: {
        where: { archivedAt: null },
        orderBy: { updatedAt: 'desc' },
        include: EQUIPMENT_INCLUDE,
      },
      termsAsOrigin: { where: { archivedAt: null }, orderBy: { createdAt: 'desc' } },
      corporateLines: {
        where: { archivedAt: null },
        orderBy: { normalizedNumber: 'asc' },
        include: {
          equipment: {
            select: {
              id: true,
              patrimony: true,
              assetTag: true,
              name: true,
              category: { select: { name: true } },
            },
          },
        },
      },
      movementsFrom: {
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { equipment: { select: { id: true, patrimony: true, assetTag: true, name: true } } },
      },
      movementsTo: {
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { equipment: { select: { id: true, patrimony: true, assetTag: true, name: true } } },
      },
    },
  })
  if (!person) throw new InventoryNotFoundError('Pessoa não encontrada.')
  const [extensions, audit] = await Promise.all([
    prisma.inventoryExtension.findMany({
      where: {
        portalId,
        archivedAt: null,
        collaborator: { equals: person.name, mode: 'insensitive' },
      },
      orderBy: { number: 'asc' },
    }),
    prisma.auditLog.findMany({
      where: {
        portalId,
        entityType: 'InventoryPerson',
        entityId: person.id,
        action: { startsWith: 'inventory_' },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ])
  const movementHistory = [...person.movementsFrom, ...person.movementsTo].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  )
  return {
    ...person,
    equipment: person.equipment.map(safeEquipment),
    extensions,
    movementHistory,
    audit,
  }
}

async function validatePersonRelations(
  client: TransactionClient,
  portalId: string,
  input: { departmentId?: string | null; bitrixUserId?: string | null },
  personId?: string,
) {
  await ensureDepartment(client, portalId, input.departmentId)
  if (input.bitrixUserId) {
    const user = await client.bitrixUser.findUnique({
      where: { portalId_bitrixUserId: { portalId, bitrixUserId: input.bitrixUserId } },
    })
    if (!user) throw new InventoryValidationError('Usuário Bitrix inválido para este portal.')
    const alreadyLinked = await client.inventoryPerson.findFirst({
      where: {
        portalId,
        bitrixUserId: input.bitrixUserId,
        ...(personId ? { id: { not: personId } } : {}),
      },
      select: { id: true, name: true },
    })
    if (alreadyLinked) {
      throw new InventoryConflictError(
        `Este usuário Bitrix já está vinculado a ${alreadyLinked.name}.`,
      )
    }
  }
}

export async function createPerson(context: InventoryContext, input: CreatePersonInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      await validatePersonRelations(tx, context.portalId, input)
      const person = await tx.inventoryPerson.create({
        data: {
          portalId: context.portalId,
          ...input,
          bitrixMatchStatus: input.bitrixUserId ? 'MATCHED' : 'UNREVIEWED',
          bitrixMatchMethod: input.bitrixUserId ? 'MANUAL' : null,
        },
        include: { department: true },
      })
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_person_created',
          entityType: 'InventoryPerson',
          entityId: person.id,
        },
        tx,
      )
      return person
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new InventoryConflictError('Este usuário Bitrix já está vinculado a outra pessoa.')
    }
    throw error
  }
}

export async function updatePerson(
  context: InventoryContext,
  personId: string,
  input: UpdatePersonInput,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockInventoryPerson(tx, context.portalId, personId)
      const exists = await tx.inventoryPerson.findFirst({
        where: { id: personId, portalId: context.portalId, archivedAt: null },
      })
      if (!exists) throw new InventoryNotFoundError('Pessoa não encontrada.')
      const { revision, ...changes } = input
      await validatePersonRelations(tx, context.portalId, changes, personId)
      if (changes.status === 'TERMINATED' && exists.status !== 'TERMINATED') {
        const heldEquipment = await tx.inventoryEquipment.count({
          where: { portalId: context.portalId, currentHolderId: personId, archivedAt: null },
        })
        if (heldEquipment > 0) {
          throw new InventoryConflictError(
            'Transfira os equipamentos desta pessoa antes de marcá-la como desligada.',
          )
        }
      }
      const updated = await tx.inventoryPerson.updateMany({
        where: { id: personId, portalId: context.portalId, archivedAt: null, revision },
        data: {
          ...changes,
          ...(changes.bitrixUserId !== undefined
            ? {
                bitrixMatchStatus: changes.bitrixUserId
                  ? ('MATCHED' as const)
                  : ('UNREVIEWED' as const),
                bitrixMatchMethod: changes.bitrixUserId ? 'MANUAL' : null,
              }
            : {}),
          revision: { increment: 1 },
        },
      })
      if (updated.count !== 1) {
        throw new InventoryConflictError(
          'O colaborador foi alterado por outra pessoa. Recarregue e tente novamente.',
        )
      }
      const person = await tx.inventoryPerson.findUniqueOrThrow({
        where: { id: personId },
        include: { department: true },
      })
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_person_updated',
          entityType: 'InventoryPerson',
          entityId: personId,
          metadata: { changedFields: Object.keys(changes) },
        },
        tx,
      )
      return person
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new InventoryConflictError('Este usuário Bitrix já está vinculado a outra pessoa.')
    }
    throw error
  }
}

export async function archivePerson(context: InventoryContext, personId: string, revision: number) {
  return prisma.$transaction(async (tx) => {
    await lockInventoryPerson(tx, context.portalId, personId)
    const person = await tx.inventoryPerson.findFirst({
      where: { id: personId, portalId: context.portalId },
    })
    if (!person) throw new InventoryNotFoundError('Pessoa não encontrada.')
    const heldEquipment = await tx.inventoryEquipment.count({
      where: { portalId: context.portalId, currentHolderId: personId, archivedAt: null },
    })
    if (heldEquipment > 0) {
      throw new InventoryConflictError(
        'Transfira os equipamentos desta pessoa antes de arquivá-la.',
      )
    }
    const updated = await tx.inventoryPerson.updateMany({
      where: { id: personId, portalId: context.portalId, revision },
      data: { archivedAt: new Date(), status: 'TERMINATED', revision: { increment: 1 } },
    })
    if (updated.count !== 1) {
      throw new InventoryConflictError(
        'O colaborador foi alterado por outra pessoa. Recarregue e tente novamente.',
      )
    }
    await recordAuditEvent(
      {
        portalId: context.portalId,
        bitrixUserId: context.bitrixUserId,
        action: 'inventory_person_archived',
        entityType: 'InventoryPerson',
        entityId: personId,
      },
      tx,
    )
    return { id: personId, archived: true }
  })
}

export async function listDepartments(portalId: string) {
  return prisma.inventoryDepartment.findMany({
    where: { portalId },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { people: true, equipment: true } } },
  })
}

export async function getDepartment(portalId: string, departmentId: string) {
  const record = await prisma.inventoryDepartment.findFirst({
    where: { id: departmentId, portalId },
    include: { _count: { select: { people: true, equipment: true } } },
  })
  if (!record) throw new InventoryNotFoundError('Setor não encontrado.')
  return record
}

export async function createDepartment(
  context: InventoryContext,
  input: { name: string; description?: string | null; active?: boolean },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const record = await tx.inventoryDepartment.create({
        data: { portalId: context.portalId, ...input },
      })
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_department_created',
          entityType: 'InventoryDepartment',
          entityId: record.id,
        },
        tx,
      )
      return record
    })
  } catch (error) {
    if (isUniqueConstraintError(error))
      throw new InventoryConflictError('Já existe um setor com este nome.')
    throw error
  }
}

export async function updateDepartment(
  context: InventoryContext,
  departmentId: string,
  input: { name?: string; description?: string | null; active?: boolean },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockInventoryResource(tx, context.portalId, 'department', departmentId)
      const exists = await tx.inventoryDepartment.findFirst({
        where: { id: departmentId, portalId: context.portalId },
      })
      if (!exists) throw new InventoryNotFoundError('Setor não encontrado.')
      if (input.active === false && exists.active) {
        const [people, equipment] = await Promise.all([
          tx.inventoryPerson.count({
            where: { portalId: context.portalId, departmentId, archivedAt: null },
          }),
          tx.inventoryEquipment.count({
            where: { portalId: context.portalId, departmentId, archivedAt: null },
          }),
        ])
        if (people + equipment > 0) {
          throw new InventoryConflictError(
            'Mova as pessoas e os equipamentos antes de desativar este setor.',
          )
        }
      }
      const record = await tx.inventoryDepartment.update({
        where: { id: departmentId },
        data: input,
      })
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_department_updated',
          entityType: 'InventoryDepartment',
          entityId: departmentId,
          metadata: { changedFields: Object.keys(input) },
        },
        tx,
      )
      return record
    })
  } catch (error) {
    if (isUniqueConstraintError(error))
      throw new InventoryConflictError('Já existe um setor com este nome.')
    throw error
  }
}

export async function listLocations(portalId: string) {
  return prisma.inventoryLocation.findMany({
    where: { portalId },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { equipment: true } } },
  })
}

export async function getLocation(portalId: string, locationId: string) {
  const record = await prisma.inventoryLocation.findFirst({
    where: { id: locationId, portalId },
    include: { _count: { select: { equipment: true } } },
  })
  if (!record) throw new InventoryNotFoundError('Local não encontrado.')
  return record
}

export async function createLocation(
  context: InventoryContext,
  input: { name: string; description?: string | null; active?: boolean },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const record = await tx.inventoryLocation.create({
        data: { portalId: context.portalId, ...input },
      })
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_location_created',
          entityType: 'InventoryLocation',
          entityId: record.id,
        },
        tx,
      )
      return record
    })
  } catch (error) {
    if (isUniqueConstraintError(error))
      throw new InventoryConflictError('Já existe um local com este nome.')
    throw error
  }
}

export async function updateLocation(
  context: InventoryContext,
  locationId: string,
  input: { name?: string; description?: string | null; active?: boolean },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockInventoryResource(tx, context.portalId, 'location', locationId)
      const exists = await tx.inventoryLocation.findFirst({
        where: { id: locationId, portalId: context.portalId },
      })
      if (!exists) throw new InventoryNotFoundError('Local não encontrado.')
      if (input.active === false && exists.active) {
        const equipment = await tx.inventoryEquipment.count({
          where: { portalId: context.portalId, locationId, archivedAt: null },
        })
        if (equipment > 0) {
          throw new InventoryConflictError('Mova os equipamentos antes de desativar este local.')
        }
      }
      const record = await tx.inventoryLocation.update({ where: { id: locationId }, data: input })
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_location_updated',
          entityType: 'InventoryLocation',
          entityId: locationId,
          metadata: { changedFields: Object.keys(input) },
        },
        tx,
      )
      return record
    })
  } catch (error) {
    if (isUniqueConstraintError(error))
      throw new InventoryConflictError('Já existe um local com este nome.')
    throw error
  }
}

export async function listCategories(portalId: string) {
  return prisma.inventoryCategory.findMany({
    where: { portalId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      fields: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] },
      _count: { select: { equipment: true } },
    },
  })
}

export async function getCategory(portalId: string, categoryId: string) {
  const record = await prisma.inventoryCategory.findFirst({
    where: { id: categoryId, portalId },
    include: {
      fields: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] },
      _count: { select: { equipment: true } },
    },
  })
  if (!record) throw new InventoryNotFoundError('Categoria não encontrada.')
  return record
}

export async function createCategory(
  context: InventoryContext,
  input: {
    name: string
    prefix?: string | null
    icon?: string
    description?: string | null
    sortOrder?: number
    active?: boolean
  },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const record = await tx.inventoryCategory.create({
        data: { portalId: context.portalId, ...input },
        include: { fields: true },
      })
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_category_created',
          entityType: 'InventoryCategory',
          entityId: record.id,
        },
        tx,
      )
      return record
    })
  } catch (error) {
    if (isUniqueConstraintError(error))
      throw new InventoryConflictError('Já existe uma categoria com este nome.')
    throw error
  }
}

export async function updateCategory(
  context: InventoryContext,
  categoryId: string,
  input: {
    revision: number
    name?: string
    prefix?: string | null
    icon?: string
    description?: string | null
    sortOrder?: number
    active?: boolean
  },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockInventoryResource(tx, context.portalId, 'category', categoryId)
      const exists = await tx.inventoryCategory.findFirst({
        where: { id: categoryId, portalId: context.portalId },
      })
      if (!exists) throw new InventoryNotFoundError('Categoria não encontrada.')
      const { revision, ...data } = input
      if (data.active === false && exists.active) {
        const equipment = await tx.inventoryEquipment.count({
          where: { portalId: context.portalId, categoryId, archivedAt: null },
        })
        if (equipment > 0) {
          throw new InventoryConflictError(
            'Mova ou arquive os equipamentos antes de desativar esta categoria.',
          )
        }
      }
      const result = await tx.inventoryCategory.updateMany({
        where: { id: categoryId, portalId: context.portalId, revision },
        data: { ...data, revision: { increment: 1 } },
      })
      if (result.count !== 1)
        throw new InventoryConflictError('A categoria foi alterada por outra pessoa.')
      const record = await tx.inventoryCategory.findUniqueOrThrow({
        where: { id: categoryId },
        include: { fields: true },
      })
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_category_updated',
          entityType: 'InventoryCategory',
          entityId: categoryId,
          metadata: { changedFields: Object.keys(data) },
        },
        tx,
      )
      return record
    })
  } catch (error) {
    if (isUniqueConstraintError(error))
      throw new InventoryConflictError('Já existe uma categoria com este nome.')
    throw error
  }
}

export async function createCategoryField(
  context: InventoryContext,
  categoryId: string,
  input: {
    key: string
    label: string
    type?: InventoryFieldType
    options?: string[]
    sortOrder?: number
    required?: boolean
    listVisible?: boolean
    active?: boolean
  },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      await ensureCategory(tx, context.portalId, categoryId)
      if (input.type === 'PASSWORD' && input.required) {
        throw new InventoryValidationError('Campos PASSWORD não podem ser obrigatórios.')
      }
      if (input.required) {
        const equipment = await tx.inventoryEquipment.count({
          where: { portalId: context.portalId, categoryId },
        })
        if (equipment > 0) {
          throw new InventoryConflictError(
            'Não é possível criar um campo obrigatório sem preencher os equipamentos existentes.',
          )
        }
      }
      const field = await tx.inventoryField.create({
        data: {
          portalId: context.portalId,
          categoryId,
          ...input,
          ...(input.type !== undefined && input.type !== 'SELECT' ? { options: [] } : {}),
        },
      })
      await tx.inventoryCategory.update({
        where: { id: categoryId },
        data: { revision: { increment: 1 } },
      })
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_category_field_created',
          entityType: 'InventoryField',
          entityId: field.id,
          metadata: { categoryId, key: input.key, type: input.type ?? 'TEXT' },
        },
        tx,
      )
      return field
    })
  } catch (error) {
    if (isUniqueConstraintError(error))
      throw new InventoryConflictError('Já existe um campo com esta chave na categoria.')
    throw error
  }
}

export async function updateCategoryField(
  context: InventoryContext,
  categoryId: string,
  fieldId: string,
  input: Partial<{
    key: string
    label: string
    type: InventoryFieldType
    options: string[]
    sortOrder: number
    required: boolean
    listVisible: boolean
    active: boolean
  }>,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockInventoryResource(tx, context.portalId, 'category', categoryId)
      const exists = await tx.inventoryField.findFirst({
        where: { id: fieldId, categoryId, portalId: context.portalId },
      })
      if (!exists) throw new InventoryNotFoundError('Campo não encontrado.')
      const resultingType = input.type ?? exists.type
      const resultingRequired = input.required ?? exists.required
      if (resultingType === 'PASSWORD' && resultingRequired) {
        throw new InventoryValidationError('Campos PASSWORD não podem ser obrigatórios.')
      }
      const destructiveChange =
        (input.key !== undefined && input.key !== exists.key) ||
        (input.type !== undefined && input.type !== exists.type) ||
        (input.options !== undefined &&
          JSON.stringify(input.options) !== JSON.stringify(exists.options)) ||
        (input.active === false && exists.active)
      const enablingRequired = input.required === true && !exists.required
      if ((destructiveChange && input.type !== 'PASSWORD') || enablingRequired) {
        const equipment = await tx.inventoryEquipment.findMany({
          where: { portalId: context.portalId, categoryId },
          select: { specs: true, legacyInvalidSpecs: true },
        })
        const hasValues = equipment.some((item) => {
          const canonical = asJsonRecord(item.specs)[exists.key]
          const quarantined = asJsonRecord(item.legacyInvalidSpecs)[exists.key]
          return !isValueEmpty(canonical) || !isValueEmpty(quarantined)
        })
        const hasMissingRequired = equipment.some((item) => {
          const value = asJsonRecord(item.specs)[exists.key]
          return isValueEmpty(value)
        })
        if (
          (destructiveChange && input.type !== 'PASSWORD' && hasValues) ||
          (enablingRequired && hasMissingRequired)
        ) {
          throw new InventoryConflictError(
            enablingRequired && hasMissingRequired
              ? 'Preencha este campo em todos os equipamentos antes de torná-lo obrigatório.'
              : 'Este campo possui valores. Limpe-os antes de alterar chave, tipo, opções ou ativação.',
          )
        }
      }
      if (exists.type === 'PASSWORD' || input.type === 'PASSWORD') {
        // Remove qualquer segredo legado na mesma transação em que o campo
        // passa a ser PASSWORD. A API também redige na leitura.
        const equipment = await tx.inventoryEquipment.findMany({
          where: { portalId: context.portalId, categoryId },
          select: { id: true, specs: true, legacyInvalidSpecs: true },
        })
        for (const item of equipment) {
          const specs = asJsonRecord(item.specs)
          const legacyInvalidSpecs = asJsonRecord(item.legacyInvalidSpecs)
          const hasCanonical = Object.prototype.hasOwnProperty.call(specs, exists.key)
          const hasQuarantined = Object.prototype.hasOwnProperty.call(
            legacyInvalidSpecs,
            exists.key,
          )
          if (hasCanonical || hasQuarantined) {
            if (hasCanonical) delete specs[exists.key]
            if (hasQuarantined) delete legacyInvalidSpecs[exists.key]
            await tx.inventoryEquipment.update({
              where: { id: item.id },
              data: {
                specs: specs as Prisma.InputJsonValue,
                legacyInvalidSpecs: legacyInvalidSpecs as Prisma.InputJsonValue,
                revision: { increment: 1 },
              },
            })
          }
        }
      }
      const field = await tx.inventoryField.update({
        where: { id: fieldId },
        data: {
          ...input,
          ...(input.type !== undefined && input.type !== 'SELECT' ? { options: [] } : {}),
        },
      })
      await tx.inventoryCategory.update({
        where: { id: categoryId },
        data: { revision: { increment: 1 } },
      })
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_category_field_updated',
          entityType: 'InventoryField',
          entityId: fieldId,
          metadata: { categoryId, changedFields: Object.keys(input) },
        },
        tx,
      )
      return field
    })
  } catch (error) {
    if (isUniqueConstraintError(error))
      throw new InventoryConflictError('Já existe um campo com esta chave na categoria.')
    throw error
  }
}

export async function deactivateCategoryField(
  context: InventoryContext,
  categoryId: string,
  fieldId: string,
) {
  return updateCategoryField(context, categoryId, fieldId, { active: false })
}

export async function listRoleAssignments(portalId: string) {
  const assignments = await prisma.inventoryRoleAssignment.findMany({
    where: { portalId },
    orderBy: { updatedAt: 'desc' },
  })
  const userIds = assignments.map((assignment) => assignment.bitrixUserId)
  const users = await prisma.bitrixUser.findMany({
    where: { portalId, bitrixUserId: { in: userIds } },
    select: { bitrixUserId: true, fullName: true, email: true, active: true },
  })
  const byId = new Map(users.map((user) => [user.bitrixUserId, user]))
  return assignments.map((assignment) => ({
    ...assignment,
    user: byId.get(assignment.bitrixUserId) ?? null,
  }))
}

export async function setRoleAssignment(
  context: InventoryContext,
  input: { bitrixUserId: string; role: 'ADMIN' | 'OPERATOR' | 'VIEWER' },
) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.bitrixUser.findUnique({
      where: {
        portalId_bitrixUserId: { portalId: context.portalId, bitrixUserId: input.bitrixUserId },
      },
    })
    if (!target) throw new InventoryValidationError('Usuário Bitrix inválido para este portal.')
    const assignment = await tx.inventoryRoleAssignment.upsert({
      where: {
        portalId_bitrixUserId: { portalId: context.portalId, bitrixUserId: input.bitrixUserId },
      },
      create: {
        portalId: context.portalId,
        bitrixUserId: input.bitrixUserId,
        role: input.role,
        createdByBitrixUserId: context.bitrixUserId,
      },
      update: { role: input.role },
    })
    await recordAuditEvent(
      {
        portalId: context.portalId,
        bitrixUserId: context.bitrixUserId,
        action: 'inventory_role_assignment_set',
        entityType: 'InventoryRoleAssignment',
        entityId: assignment.id,
        metadata: { targetBitrixUserId: input.bitrixUserId, role: input.role },
      },
      tx,
    )
    return assignment
  })
}

export async function deleteRoleAssignment(context: InventoryContext, targetBitrixUserId: string) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.inventoryRoleAssignment.findUnique({
      where: {
        portalId_bitrixUserId: { portalId: context.portalId, bitrixUserId: targetBitrixUserId },
      },
    })
    if (!assignment) throw new InventoryNotFoundError('Atribuição não encontrada.')
    await tx.inventoryRoleAssignment.delete({ where: { id: assignment.id } })
    await recordAuditEvent(
      {
        portalId: context.portalId,
        bitrixUserId: context.bitrixUserId,
        action: 'inventory_role_assignment_deleted',
        entityType: 'InventoryRoleAssignment',
        entityId: assignment.id,
        metadata: { targetBitrixUserId },
      },
      tx,
    )
    return { bitrixUserId: targetBitrixUserId, deleted: true }
  })
}

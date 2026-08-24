import type { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { inventoryTodayUtc } from './date'
import { redactPasswordValues } from './service'

export type InventoryExpirationStatus = 'EXPIRED' | 'UPCOMING'

export interface InventoryExpirationItem {
  id: string
  kind: 'EQUIPMENT_WARRANTY' | 'CUSTOM_RECORD'
  label: string
  detail: string | null
  dueDate: string
  status: InventoryExpirationStatus
  href: string
}

interface PageQuery {
  page: number
  pageSize: number
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function currentDate(): Date {
  return inventoryTodayUtc()
}

function parseJsonDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || dateOnly(parsed) !== value) return null
  return parsed
}

function paginate<T>(items: T[], query: PageQuery) {
  const total = items.length
  const start = (query.page - 1) * query.pageSize
  return {
    items: items.slice(start, start + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  }
}

export async function listInventoryExpirations(
  portalId: string,
  query: PageQuery & { status: 'all' | 'expired' | 'upcoming'; windowDays: number },
) {
  const today = currentDate()
  const windowEnd = new Date(today)
  windowEnd.setUTCDate(windowEnd.getUTCDate() + query.windowDays)

  const [equipment, modules] = await Promise.all([
    prisma.inventoryEquipment.findMany({
      where: { portalId, archivedAt: null, warrantyEndsAt: { not: null } },
      select: {
        id: true,
        patrimony: true,
        assetTag: true,
        name: true,
        warrantyEndsAt: true,
        category: { select: { name: true } },
      },
    }),
    prisma.inventoryCustomModule.findMany({
      where: { portalId, active: true, fields: { some: { active: true, expiryAlert: true } } },
      select: {
        id: true,
        name: true,
        fields: {
          where: { active: true, expiryAlert: true, type: 'DATE' },
          select: { key: true, label: true },
        },
        records: {
          where: { archivedAt: null },
          select: { id: true, title: true, data: true },
        },
      },
    }),
  ])

  const items: InventoryExpirationItem[] = []
  for (const item of equipment) {
    if (!item.warrantyEndsAt) continue
    items.push({
      id: `equipment:${item.id}`,
      kind: 'EQUIPMENT_WARRANTY',
      label: item.patrimony || item.assetTag || item.name || 'Equipamento sem identificação',
      detail: `Garantia · ${item.category.name}`,
      dueDate: dateOnly(item.warrantyEndsAt),
      status: item.warrantyEndsAt < today ? 'EXPIRED' : 'UPCOMING',
      href: `/inventory/equipment/${item.id}`,
    })
  }

  for (const customModule of modules) {
    for (const record of customModule.records) {
      const data =
        record.data && typeof record.data === 'object' && !Array.isArray(record.data)
          ? (record.data as Record<string, unknown>)
          : {}
      for (const field of customModule.fields) {
        const due = parseJsonDate(data[field.key])
        if (!due) continue
        items.push({
          id: `record:${record.id}:${field.key}`,
          kind: 'CUSTOM_RECORD',
          label: record.title || 'Registro sem título',
          detail: `${customModule.name} · ${field.label}`,
          dueDate: dateOnly(due),
          status: due < today ? 'EXPIRED' : 'UPCOMING',
          href: `/inventory/custom/${customModule.id}`,
        })
      }
    }
  }

  const filtered = items
    .filter((item) => {
      const due = new Date(`${item.dueDate}T00:00:00.000Z`)
      if (query.status === 'expired') return due < today
      if (query.status === 'upcoming') return due >= today && due <= windowEnd
      return due <= windowEnd
    })
    .sort(
      (left, right) =>
        left.dueDate.localeCompare(right.dueDate) || left.label.localeCompare(right.label),
    )

  return {
    ...paginate(filtered, query),
    windowDays: query.windowDays,
    counts: {
      expired: items.filter((item) => item.status === 'EXPIRED').length,
      upcoming: items.filter((item) => {
        const due = new Date(`${item.dueDate}T00:00:00.000Z`)
        return due >= today && due <= windowEnd
      }).length,
    },
  }
}

export async function listInventoryMovements(portalId: string, query: PageQuery & { q?: string }) {
  const where: Prisma.InventoryMovementWhereInput = {
    portalId,
    ...(query.q
      ? {
          OR: [
            { fromPersonName: { contains: query.q, mode: 'insensitive' } },
            { toPersonName: { contains: query.q, mode: 'insensitive' } },
            { fromDepartmentName: { contains: query.q, mode: 'insensitive' } },
            { toDepartmentName: { contains: query.q, mode: 'insensitive' } },
            { reason: { contains: query.q, mode: 'insensitive' } },
            { equipment: { patrimony: { contains: query.q, mode: 'insensitive' } } },
            { equipment: { assetTag: { contains: query.q, mode: 'insensitive' } } },
            { equipment: { name: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
  const [items, total] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      orderBy: [{ movedAt: 'desc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        equipment: { select: { id: true, patrimony: true, assetTag: true, name: true } },
      },
    }),
    prisma.inventoryMovement.count({ where }),
  ])
  return { ...paginate([], query), items, total, totalPages: Math.ceil(total / query.pageSize) }
}

export async function listInventoryAudit(
  portalId: string,
  query: PageQuery & {
    q?: string
    action?: string
    entityType?: string
    dateFrom?: string
    dateTo?: string
  },
) {
  const where: Prisma.AuditLogWhereInput = {
    portalId,
    action: query.action ? { equals: query.action } : { startsWith: 'inventory_' },
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          createdAt: {
            ...(query.dateFrom ? { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) } : {}),
            ...(query.dateTo ? { lte: new Date(`${query.dateTo}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...(query.q
      ? {
          AND: [
            {
              OR: [
                { action: { contains: query.q, mode: 'insensitive' } },
                { entityType: { contains: query.q, mode: 'insensitive' } },
                { entityId: { contains: query.q, mode: 'insensitive' } },
                { bitrixUserId: { contains: query.q, mode: 'insensitive' } },
              ],
            },
          ],
        }
      : {}),
  }
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ])
  const userIds = [...new Set(items.map((item) => item.bitrixUserId))]
  const users = await prisma.bitrixUser.findMany({
    where: { portalId, bitrixUserId: { in: userIds } },
    select: { bitrixUserId: true, fullName: true },
  })
  const names = new Map(users.map((user) => [user.bitrixUserId, user.fullName]))
  return {
    ...paginate([], query),
    items: items.map((item) => ({ ...item, userName: names.get(item.bitrixUserId) ?? null })),
    total,
    totalPages: Math.ceil(total / query.pageSize),
  }
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'object') return JSON.stringify(value)
  const text = String(value)
  // Impede que Excel/LibreOffice interpretem dados controlados por usuário
  // como fórmulas ao abrir o arquivo.
  return /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
}

export function serializeInventoryCsv(rows: unknown[][]): string {
  return `\uFEFF${rows
    .map((row) => row.map((value) => `"${csvValue(value).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n')}\r\n`
}

export async function exportInventoryEquipmentCsv(
  portalId: string,
  opts: {
    categoryId?: string
    status?: string
    departmentId?: string
    locationId?: string
    q?: string
    archived?: boolean
  } = {},
) {
  const { categoryId, status, departmentId, locationId, q, archived } = opts
  const archivedFilter = archived ? {} : { archivedAt: null }
  const equipment = await prisma.inventoryEquipment.findMany({
    where: {
      portalId,
      ...archivedFilter,
      ...(categoryId ? { categoryId } : {}),
      ...(status ? { status: status as never } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(locationId ? { locationId } : {}),
      ...(q
        ? {
            OR: [
              { patrimony: { contains: q, mode: 'insensitive' } },
              { assetTag: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
              { serialNumber: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ category: { sortOrder: 'asc' } }, { patrimony: 'asc' }, { id: 'asc' }],
    include: {
      category: {
        include: {
          fields: {
            orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
          },
        },
      },
      currentHolder: { select: { name: true } },
      department: { select: { name: true } },
      location: { select: { name: true } },
    },
  })

  const fieldColumns = categoryId && equipment.length > 0
    ? (equipment[0]?.category.fields ?? [])
        .filter((field) => field.active && field.listVisible && field.type !== 'PASSWORD')
        .map((field) => ({
          key: field.key,
          label: field.label,
        }))
    : []
  const headers = [
    'Código/TAG',
    'Nº patrimônio',
    'Nome',
    'Categoria',
    'Situação',
    'Responsável',
    'Setor',
    'Local',
    'Série',
    'Nota fiscal',
    'Recebimento',
    'Entrega',
    'Fim da garantia',
    ...(categoryId ? fieldColumns.map((field) => field.label) : ['Especificações']),
    'Valores legados para revisão',
    'Observações',
  ]
  const rows: unknown[][] = [headers]
  for (const item of equipment) {
    const specs = redactPasswordValues(item.specs, item.category.fields)
    rows.push([
      item.patrimony,
      item.assetTag,
      item.name,
      item.category.name,
      item.status,
      item.currentHolder?.name,
      item.department?.name,
      item.location?.name,
      item.serialNumber,
      item.invoiceNumber,
      item.receivedAt ? dateOnly(item.receivedAt) : null,
      item.deliveredAt ? dateOnly(item.deliveredAt) : null,
      item.warrantyEndsAt ? dateOnly(item.warrantyEndsAt) : null,
      ...(categoryId ? fieldColumns.map((field) => specs[field.key]) : [specs]),
      redactPasswordValues(item.legacyInvalidSpecs, item.category.fields),
      item.notes,
    ])
  }
  return { csv: serializeInventoryCsv(rows), count: equipment.length }
}

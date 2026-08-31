import { inventoryErrorResponse, requireInventoryContext } from '@/src/modules/inventory/http'
import { prisma } from '@/src/lib/prisma'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const BOM = '﻿'

function row(cells: (string | null | undefined)[]): string {
  return cells.map((c) => `"${(c ?? '').replace(/"/g, '""')}"`).join(',')
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toISOString().slice(0, 10)
}

const STATUS: Record<string, string> = {
  ACTIVE: 'Ativa', SUSPENDED: 'Suspensa', CANCELLED: 'Cancelada', AVAILABLE: 'Disponível',
}

export async function GET(request: Request) {
  try {
    const ctx = await requireInventoryContext(request)
    const sp = new URL(request.url).searchParams

    const where: Prisma.InventoryCorporateLineWhereInput = { portalId: ctx.portalId }
    const archived = sp.get('archived') ?? 'exclude'
    if (archived === 'exclude') where.archivedAt = null
    else if (archived === 'only') where.archivedAt = { not: null }

    const q = sp.get('q')
    if (q) {
      where.OR = [
        { number: { contains: q, mode: 'insensitive' } },
        { carrier: { contains: q, mode: 'insensitive' } },
        { plan: { contains: q, mode: 'insensitive' } },
        { currentHolder: { name: { contains: q, mode: 'insensitive' } } },
      ]
    }
    const status = sp.get('status') as Prisma.EnumInventoryCorporateLineStatusFilter['equals']
    if (status) where.status = status
    const holderId = sp.get('holderId')
    if (holderId) where.currentHolderId = holderId

    const lines = await prisma.inventoryCorporateLine.findMany({
      where,
      include: {
        currentHolder: { select: { name: true } },
        equipment: { select: { patrimony: true, assetTag: true, name: true } },
      },
      orderBy: { number: 'asc' },
      take: 5000,
    })

    const headers = row(['Número', 'Operadora', 'Plano', 'Franquia', 'Situação', 'Colaborador', 'Patrimônio', 'Equipamento', 'Slot SIM', 'Ativação', 'Suspensão'])
    const rows = lines.map((l) => {
      const eq = l.equipment
      const eqLabel = eq ? [eq.patrimony, eq.assetTag, eq.name].filter(Boolean).join(' / ') : null
      return row([
        l.number,
        l.carrier,
        l.plan,
        l.dataAllowance,
        STATUS[l.status] ?? l.status,
        l.currentHolder?.name,
        eq?.patrimony,
        eqLabel,
        l.simSlot,
        formatDate(l.activatedAt),
        formatDate(l.suspendedAt),
      ])
    })

    const csv = BOM + [headers, ...rows].join('\r\n')

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="linhas-corporativas.csv"',
      },
    })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

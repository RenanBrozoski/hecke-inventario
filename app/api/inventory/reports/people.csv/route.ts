import { inventoryErrorResponse, requireInventoryContext } from '@/src/modules/inventory/http'
import { prisma } from '@/src/lib/prisma'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const BOM = '﻿'

function row(cells: (string | null | undefined)[]): string {
  return cells.map((c) => `"${(c ?? '').replace(/"/g, '""')}"`).join(',')
}

const STATUS: Record<string, string> = {
  ACTIVE: 'Ativo', INACTIVE: 'Inativo', TERMINATED: 'Desligado', ON_LEAVE: 'Afastado',
}
const EMPLOYMENT: Record<string, string> = {
  CLT: 'CLT', PJ: 'PJ', INTERN: 'Estágio', TEMPORARY: 'Temporário', VOLUNTEER: 'Voluntário',
}
const BITRIX: Record<string, string> = {
  MATCHED: 'Vinculado', UNMATCHED: 'Não vinculado', UNREVIEWED: 'Não revisado',
  AMBIGUOUS: 'Ambíguo', REJECTED: 'Rejeitado',
}

export async function GET(request: Request) {
  try {
    const ctx = await requireInventoryContext(request)
    const sp = new URL(request.url).searchParams

    const where: Prisma.InventoryPersonWhereInput = { portalId: ctx.portalId }
    const archived = sp.get('archived') ?? 'exclude'
    if (archived === 'exclude') where.archivedAt = null
    else if (archived === 'only') where.archivedAt = { not: null }

    const q = sp.get('q')
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { cpf: { contains: q, mode: 'insensitive' } },
        { employeeNumber: { contains: q, mode: 'insensitive' } },
      ]
    }
    const status = sp.get('status') as Prisma.EnumInventoryPersonStatusFilter['equals']
    if (status) where.status = status
    const departmentId = sp.get('departmentId')
    if (departmentId) where.departmentId = departmentId
    const employmentType = sp.get('employmentType') as Prisma.EnumInventoryEmploymentTypeNullableFilter['equals']
    if (employmentType) where.employmentType = employmentType
    const bitrixMatchStatus = sp.get('bitrixMatchStatus') as Prisma.EnumInventoryMatchStatusFilter['equals']
    if (bitrixMatchStatus) where.bitrixMatchStatus = bitrixMatchStatus

    const people = await prisma.inventoryPerson.findMany({
      where,
      include: { department: { select: { name: true } } },
      orderBy: { name: 'asc' },
      take: 5000,
    })

    const headers = row(['Nome', 'E-mail', 'CPF', 'Matrícula', 'Cargo', 'Setor', 'Situação', 'Vínculo empregatício', 'Bitrix24', 'ID Bitrix'])
    const rows = people.map((p) =>
      row([
        p.name,
        p.email,
        p.cpf,
        p.employeeNumber,
        p.title,
        p.department?.name,
        STATUS[p.status] ?? p.status,
        p.employmentType ? (EMPLOYMENT[p.employmentType] ?? p.employmentType) : null,
        p.bitrixMatchStatus ? (BITRIX[p.bitrixMatchStatus] ?? p.bitrixMatchStatus) : null,
        p.bitrixUserId,
      ])
    )

    const csv = BOM + [headers, ...rows].join('\r\n')

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="colaboradores.csv"',
      },
    })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

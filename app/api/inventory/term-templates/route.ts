import { z } from 'zod'
import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

const DEFAULT_TEMPLATES = [
  {
    name: 'CLT — Hecke',
    employerName: 'HECKE REPRESENTAÇÕES COMERCIAIS LTDA',
    employerCnpj: '05.094.612/0001-04',
    isPJ: false,
    dateFormat: 'city',
    sortOrder: 0,
  },
  {
    name: 'PJ — Hecke',
    employerName: 'HECKE REPRESENTAÇÕES COMERCIAIS LTDA',
    employerCnpj: '05.094.612/0001-04',
    isPJ: true,
    dateFormat: 'blank',
    sortOrder: 1,
  },
  {
    name: 'CLT — MarketMove',
    employerName: 'MARKETMOVE SERVIÇOS DE MERCHANDISING LTDA',
    employerCnpj: '58.301.921/0001-74',
    isPJ: false,
    dateFormat: 'city',
    sortOrder: 2,
  },
  {
    name: 'PJ — MarketMove',
    employerName: 'MARKETMOVE SERVIÇOS DE MERCHANDISING LTDA',
    employerCnpj: '58.301.921/0001-74',
    isPJ: true,
    dateFormat: 'blank',
    sortOrder: 3,
  },
]

async function ensureDefaults(portalId: string) {
  const count = await prisma.inventoryTermTemplate.count({ where: { portalId } })
  if (count === 0) {
    await prisma.inventoryTermTemplate.createMany({
      data: DEFAULT_TEMPLATES.map((t) => ({ portalId, ...t })),
    })
  }
}

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  employerName: z.string().trim().min(1).max(300),
  employerCnpj: z.string().trim().min(1).max(30),
  isPJ: z.boolean(),
  dateFormat: z.enum(['city', 'blank']).default('city'),
  sortOrder: z.number().int().min(0).default(0),
})

// GET — list active templates (seeds defaults if none exist)
export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    await ensureDefaults(portalId)
    const templates = await prisma.inventoryTermTemplate.findMany({
      where: { portalId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        employerName: true,
        employerCnpj: true,
        isPJ: true,
        dateFormat: true,
        sortOrder: true,
      },
    })
    return jsonOk(templates)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

// POST — create a new template (admin only)
export async function POST(request: Request) {
  try {
    const ctx = await requireInventoryContext(request)
    requireInventoryRole(ctx, 'ADMIN')
    const body = bodySchema.parse(await parseJsonBody(request))
    const template = await prisma.inventoryTermTemplate.create({
      data: { portalId: ctx.portalId, ...body },
    })
    return jsonOk(template)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

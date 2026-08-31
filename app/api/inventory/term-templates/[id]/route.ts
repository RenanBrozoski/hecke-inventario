import { z } from 'zod'
import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
  InventoryNotFoundError,
} from '@/src/modules/inventory/http'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  employerName: z.string().trim().min(1).max(300).optional(),
  employerCnpj: z.string().trim().min(1).max(30).optional(),
  isPJ: z.boolean().optional(),
  dateFormat: z.enum(['city', 'blank']).optional(),
  sortOrder: z.number().int().min(0).optional(),
})

// PATCH — update a template field (admin only)
export async function PATCH(request: Request, route: RouteContext) {
  try {
    const ctx = await requireInventoryContext(request)
    requireInventoryRole(ctx, 'ADMIN')
    const { id } = await route.params
    const body = bodySchema.parse(await parseJsonBody(request))

    const existing = await prisma.inventoryTermTemplate.findFirst({
      where: { id, portalId: ctx.portalId, active: true },
    })
    if (!existing) throw new InventoryNotFoundError('Modelo não encontrado.')

    const updated = await prisma.inventoryTermTemplate.update({
      where: { id },
      data: body,
    })
    return jsonOk(updated)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

// DELETE — deactivate a template (admin only)
export async function DELETE(request: Request, route: RouteContext) {
  try {
    const ctx = await requireInventoryContext(request)
    requireInventoryRole(ctx, 'ADMIN')
    const { id } = await route.params

    const existing = await prisma.inventoryTermTemplate.findFirst({
      where: { id, portalId: ctx.portalId, active: true },
    })
    if (!existing) throw new InventoryNotFoundError('Modelo não encontrado.')

    await prisma.inventoryTermTemplate.update({ where: { id }, data: { active: false } })
    return jsonOk({ deleted: true })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

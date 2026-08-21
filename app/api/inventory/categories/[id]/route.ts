import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { updateCategorySchema } from '@/src/modules/inventory/schemas'
import { getCategory, updateCategory } from '@/src/modules/inventory/service'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
const deleteQuerySchema = z.object({ revision: z.coerce.number().int().min(1) })

export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const { id } = await route.params
    return jsonOk(await getCategory(portalId, id))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function PATCH(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const { id } = await route.params
    const body = updateCategorySchema.parse(await parseJsonBody(request))
    return jsonOk(await updateCategory(context, id, body))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function DELETE(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const { id } = await route.params
    const { revision } = deleteQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    )
    return jsonOk(await updateCategory(context, id, { revision, active: false }))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

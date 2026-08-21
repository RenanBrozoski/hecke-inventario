import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { updateFieldSchema } from '@/src/modules/inventory/schemas'
import { deactivateCategoryField, updateCategoryField } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string; fieldId: string }> }

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const { id, fieldId } = await route.params
    const body = updateFieldSchema.parse(await parseJsonBody(request))
    return jsonOk(await updateCategoryField(context, id, fieldId, body))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function DELETE(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const { id, fieldId } = await route.params
    return jsonOk(await deactivateCategoryField(context, id, fieldId))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { updateReceivingSchema } from '@/src/modules/inventory/schemas'
import {
  archiveReceiving,
  getReceiving,
  updateReceiving,
} from '@/src/modules/inventory/secondary-service'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, route: RouteContext) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const { id } = await route.params
    return jsonOk(await getReceiving(portalId, id))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id } = await route.params
    const body = updateReceivingSchema.parse(await parseJsonBody(request))
    return jsonOk(await updateReceiving(context, id, body))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function DELETE(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id } = await route.params
    return jsonOk(await archiveReceiving(context, id))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

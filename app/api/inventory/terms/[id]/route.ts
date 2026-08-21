import {
  inventoryErrorResponse,
  jsonOk,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { archiveTerm, getTerm } from '@/src/modules/inventory/secondary-service'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, route: RouteContext) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const { id } = await route.params
    return jsonOk(await getTerm(portalId, id))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function DELETE(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id } = await route.params
    return jsonOk(await archiveTerm(context, id))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

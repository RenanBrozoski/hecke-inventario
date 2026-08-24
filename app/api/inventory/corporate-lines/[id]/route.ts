import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import {
  corporateLineDeleteQuerySchema,
  searchParamsObject,
  updateCorporateLineSchema,
} from '@/src/modules/inventory/schemas'
import {
  archiveCorporateLine,
  getCorporateLine,
  updateCorporateLine,
} from '@/src/modules/inventory/corporate-line-service'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, route: RouteContext) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const { id } = await route.params
    return jsonOk(await getCorporateLine(portalId, id))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id } = await route.params
    const body = updateCorporateLineSchema.parse(await parseJsonBody(request))
    return jsonOk(await updateCorporateLine(context, id, body))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function DELETE(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id } = await route.params
    const { revision } = corporateLineDeleteQuerySchema.parse(searchParamsObject(new URL(request.url)))
    return jsonOk(await archiveCorporateLine(context, id, revision))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

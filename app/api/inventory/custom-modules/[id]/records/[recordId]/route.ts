import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { updateCustomRecordSchema } from '@/src/modules/inventory/schemas'
import {
  archiveCustomRecord,
  getCustomRecord,
  updateCustomRecord,
} from '@/src/modules/inventory/secondary-service'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string; recordId: string }> }

export async function GET(request: Request, route: RouteContext) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const { id, recordId } = await route.params
    return jsonOk(await getCustomRecord(portalId, id, recordId))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id, recordId } = await route.params
    const body = updateCustomRecordSchema.parse(await parseJsonBody(request))
    return jsonOk(await updateCustomRecord(context, id, recordId, body))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function DELETE(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id, recordId } = await route.params
    return jsonOk(await archiveCustomRecord(context, id, recordId))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

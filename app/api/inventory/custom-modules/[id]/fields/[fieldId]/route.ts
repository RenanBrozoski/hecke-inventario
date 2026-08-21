import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { updateCustomModuleFieldSchema } from '@/src/modules/inventory/schemas'
import { updateCustomModuleField } from '@/src/modules/inventory/secondary-service'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string; fieldId: string }> }

async function update(request: Request, route: RouteContext, deactivate = false) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const { id, fieldId } = await route.params
    const body = deactivate
      ? { active: false }
      : updateCustomModuleFieldSchema.parse(await parseJsonBody(request))
    return jsonOk(await updateCustomModuleField(context, id, fieldId, body))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export const PATCH = (request: Request, route: RouteContext) => update(request, route)
export const DELETE = (request: Request, route: RouteContext) => update(request, route, true)

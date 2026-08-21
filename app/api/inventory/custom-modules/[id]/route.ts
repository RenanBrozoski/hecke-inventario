import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { updateCustomModuleSchema } from '@/src/modules/inventory/schemas'
import { getCustomModule, updateCustomModule } from '@/src/modules/inventory/secondary-service'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
const deleteQuerySchema = z.object({ revision: z.coerce.number().int().min(1) })
type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, route: RouteContext) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const { id } = await route.params
    return jsonOk(await getCustomModule(portalId, id))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function DELETE(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const { id } = await route.params
    const { revision } = deleteQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    )
    return jsonOk(await updateCustomModule(context, id, { revision, active: false }))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const { id } = await route.params
    const body = updateCustomModuleSchema.parse(await parseJsonBody(request))
    return jsonOk(await updateCustomModule(context, id, body))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

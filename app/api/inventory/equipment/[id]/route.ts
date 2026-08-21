import { z } from 'zod'
import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { updateEquipmentSchema } from '@/src/modules/inventory/schemas'
import { archiveEquipment, getEquipment, updateEquipment } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'
const deleteQuerySchema = z.object({ revision: z.coerce.number().int().min(1) })

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, route: RouteContext) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const { id } = await route.params
    return jsonOk(await getEquipment(portalId, id))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id } = await route.params
    const body = updateEquipmentSchema.parse(await parseJsonBody(request))
    return jsonOk(await updateEquipment(context, id, body))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function DELETE(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id } = await route.params
    const { revision } = deleteQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    )
    return jsonOk(await archiveEquipment(context, id, revision))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

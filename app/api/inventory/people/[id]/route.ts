import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { z } from 'zod'
import { updatePersonSchema } from '@/src/modules/inventory/schemas'
import { archivePerson, getPerson, updatePerson } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }
const deleteQuerySchema = z.object({ revision: z.coerce.number().int().min(1) })

export async function GET(request: Request, route: RouteContext) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const { id } = await route.params
    return jsonOk(await getPerson(portalId, id))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id } = await route.params
    const body = updatePersonSchema.parse(await parseJsonBody(request))
    return jsonOk(await updatePerson(context, id, body))
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
    return jsonOk(await archivePerson(context, id, revision))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

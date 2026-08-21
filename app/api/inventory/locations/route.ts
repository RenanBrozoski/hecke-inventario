import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { namedResourceSchema } from '@/src/modules/inventory/schemas'
import { createLocation, listLocations } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    return jsonOk({ items: await listLocations(portalId) })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const body = namedResourceSchema.parse(await parseJsonBody(request))
    return jsonOk(await createLocation(context, body), 201)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

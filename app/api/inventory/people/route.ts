import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import {
  createPersonSchema,
  peopleListQuerySchema,
  searchParamsObject,
} from '@/src/modules/inventory/schemas'
import { createPerson, listPeople } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const query = peopleListQuerySchema.parse(searchParamsObject(new URL(request.url)))
    return jsonOk(await listPeople(portalId, query))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const body = createPersonSchema.parse(await parseJsonBody(request))
    return jsonOk(await createPerson(context, body), 201)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

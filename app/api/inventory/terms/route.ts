import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import {
  searchParamsObject,
  secondaryListQuerySchema,
  termSchema,
} from '@/src/modules/inventory/schemas'
import { createTerm, listTerms } from '@/src/modules/inventory/secondary-service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const query = secondaryListQuerySchema.parse(searchParamsObject(new URL(request.url)))
    return jsonOk(await listTerms(portalId, query))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const body = termSchema.parse(await parseJsonBody(request))
    return jsonOk(await createTerm(context, body), 201)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

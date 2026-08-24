import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import {
  corporateLineListQuerySchema,
  createCorporateLineSchema,
  searchParamsObject,
} from '@/src/modules/inventory/schemas'
import { createCorporateLine, listCorporateLines } from '@/src/modules/inventory/corporate-line-service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const query = corporateLineListQuerySchema.parse(searchParamsObject(new URL(request.url)))
    return jsonOk(await listCorporateLines(portalId, query))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const body = createCorporateLineSchema.parse(await parseJsonBody(request))
    return jsonOk(await createCorporateLine(context, body), 201)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

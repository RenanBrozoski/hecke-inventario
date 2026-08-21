import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import {
  extensionSchema,
  searchParamsObject,
  secondaryListQuerySchema,
} from '@/src/modules/inventory/schemas'
import { createExtension, listExtensions } from '@/src/modules/inventory/secondary-service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const query = secondaryListQuerySchema.parse(searchParamsObject(new URL(request.url)))
    return jsonOk(await listExtensions(portalId, query))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const body = extensionSchema.parse(await parseJsonBody(request))
    return jsonOk(await createExtension(context, body), 201)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

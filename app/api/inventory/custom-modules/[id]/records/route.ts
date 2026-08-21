import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import {
  customRecordSchema,
  searchParamsObject,
  secondaryListQuerySchema,
} from '@/src/modules/inventory/schemas'
import { createCustomRecord, listCustomRecords } from '@/src/modules/inventory/secondary-service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const { id } = await route.params
    const query = secondaryListQuerySchema.parse(searchParamsObject(new URL(request.url)))
    return jsonOk(await listCustomRecords(portalId, id, query))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id } = await route.params
    const body = customRecordSchema.parse(await parseJsonBody(request))
    return jsonOk(await createCustomRecord(context, id, body), 201)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

import {
  inventoryErrorResponse,
  jsonOk,
  requireInventoryContext,
} from '@/src/modules/inventory/http'
import { paginationQuerySchema, searchParamsObject } from '@/src/modules/inventory/schemas'
import { listInventoryAudit } from '@/src/modules/inventory/report-service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const query = paginationQuerySchema.parse(searchParamsObject(new URL(request.url)))
    return jsonOk(await listInventoryAudit(portalId, query))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

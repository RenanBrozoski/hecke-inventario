import { z } from 'zod'
import {
  inventoryErrorResponse,
  jsonOk,
  requireInventoryContext,
} from '@/src/modules/inventory/http'
import { paginationQuerySchema, searchParamsObject } from '@/src/modules/inventory/schemas'
import { listInventoryAudit } from '@/src/modules/inventory/report-service'

export const dynamic = 'force-dynamic'

const querySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  action: z.string().trim().min(1).max(100).optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const query = querySchema.parse(searchParamsObject(new URL(request.url)))
    return jsonOk(await listInventoryAudit(portalId, query))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

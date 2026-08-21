import { z } from 'zod'
import {
  inventoryErrorResponse,
  jsonOk,
  requireInventoryContext,
} from '@/src/modules/inventory/http'
import { searchParamsObject } from '@/src/modules/inventory/schemas'
import { listInventoryExpirations } from '@/src/modules/inventory/report-service'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['all', 'expired', 'upcoming']).default('all'),
  windowDays: z.coerce.number().int().min(1).max(3650).default(30),
})

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const query = querySchema.parse(searchParamsObject(new URL(request.url)))
    return jsonOk(await listInventoryExpirations(portalId, query))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

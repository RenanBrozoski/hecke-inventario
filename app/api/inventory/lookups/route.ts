import {
  inventoryErrorResponse,
  jsonOk,
  requireInventoryContext,
} from '@/src/modules/inventory/http'
import { getInventoryLookups } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    return jsonOk(await getInventoryLookups(portalId))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

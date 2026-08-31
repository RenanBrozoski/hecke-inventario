import { unstable_cache } from 'next/cache'
import {
  inventoryErrorResponse,
  jsonOk,
  requireInventoryContext,
} from '@/src/modules/inventory/http'
import { getInventoryDashboard } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const cached = unstable_cache(
      () => getInventoryDashboard(portalId),
      [`dashboard`, portalId],
      { revalidate: 60, tags: [`portal:${portalId}:dashboard`] },
    )
    return jsonOk(await cached())
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

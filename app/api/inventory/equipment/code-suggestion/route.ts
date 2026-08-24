import { inventoryErrorResponse, jsonOk, requireInventoryContext } from '@/src/modules/inventory/http'
import { getEquipmentCodeSuggestion } from '@/src/modules/inventory/service'
import { z } from 'zod'

const querySchema = z.object({ categoryId: z.string().trim().min(1).max(100) })

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()))
    return jsonOk(await getEquipmentCodeSuggestion(portalId, query.categoryId))
  } catch (error) { return inventoryErrorResponse(error) }
}

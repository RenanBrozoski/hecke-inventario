import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { bulkTransferSchema } from '@/src/modules/inventory/schemas'
import { bulkTransferEquipment } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id } = await route.params
    const body = bulkTransferSchema.parse(await parseJsonBody(request))
    return jsonOk(await bulkTransferEquipment(context, id, body))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

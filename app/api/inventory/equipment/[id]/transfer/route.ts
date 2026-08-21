import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { transferEquipmentSchema } from '@/src/modules/inventory/schemas'
import { transferEquipment } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id } = await route.params
    const body = transferEquipmentSchema.parse(await parseJsonBody(request))
    return jsonOk(await transferEquipment(context, id, body))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

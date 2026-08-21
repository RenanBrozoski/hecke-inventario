import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import {
  createEquipmentSchema,
  equipmentListQuerySchema,
  searchParamsObject,
} from '@/src/modules/inventory/schemas'
import { createEquipment, listEquipment } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const query = equipmentListQuerySchema.parse(searchParamsObject(new URL(request.url)))
    return jsonOk(await listEquipment(portalId, query))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const body = createEquipmentSchema.parse(await parseJsonBody(request))
    return jsonOk(await createEquipment(context, body), 201)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

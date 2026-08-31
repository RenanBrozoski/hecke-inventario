import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import {
  createCollectorCommand,
  createCommandSchema,
  listEquipmentCommands,
} from '@/src/modules/inventory/collector-commands'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireInventoryContext(_request)
    requireInventoryRole(context, 'OPERATOR')
    const { id } = await route.params
    return jsonOk(await listEquipmentCommands(context.portalId, id))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id } = await route.params
    const body = createCommandSchema.parse(await parseJsonBody(request))
    if (body.equipmentId !== id)
      return inventoryErrorResponse(new Error('equipmentId não corresponde à rota.'))
    return jsonOk(await createCollectorCommand(context.portalId, body, context.bitrixUserId))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

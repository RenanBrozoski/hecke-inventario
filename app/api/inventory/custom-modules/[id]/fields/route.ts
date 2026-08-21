import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { customModuleFieldSchema } from '@/src/modules/inventory/schemas'
import { createCustomModuleField } from '@/src/modules/inventory/secondary-service'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const { id } = await route.params
    const body = customModuleFieldSchema.parse(await parseJsonBody(request))
    return jsonOk(await createCustomModuleField(context, id, body), 201)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

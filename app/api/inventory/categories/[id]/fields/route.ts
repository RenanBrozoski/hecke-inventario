import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { fieldSchema } from '@/src/modules/inventory/schemas'
import { createCategoryField } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const { id } = await route.params
    const body = fieldSchema.parse(await parseJsonBody(request))
    return jsonOk(await createCategoryField(context, id, body), 201)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

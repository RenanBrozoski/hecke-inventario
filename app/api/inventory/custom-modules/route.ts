import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { customModuleSchema } from '@/src/modules/inventory/schemas'
import { createCustomModule, listCustomModules } from '@/src/modules/inventory/secondary-service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    return jsonOk({ items: await listCustomModules(portalId) })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const body = customModuleSchema.parse(await parseJsonBody(request))
    return jsonOk(await createCustomModule(context, body), 201)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

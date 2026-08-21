import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { categorySchema } from '@/src/modules/inventory/schemas'
import { createCategory, listCategories } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    return jsonOk({ items: await listCategories(portalId) })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const body = categorySchema.parse(await parseJsonBody(request))
    return jsonOk(await createCategory(context, body), 201)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

import {
  inventoryErrorResponse,
  jsonOk,
  requireInventoryContext,
} from '@/src/modules/inventory/http'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    return jsonOk({
      context: {
        bitrixUserId: context.bitrixUserId,
        userName: context.userName,
        role: context.role,
        capabilities: {
          read: true,
          operate: context.role === 'OPERATOR' || context.role === 'ADMIN',
          administer: context.role === 'ADMIN',
        },
      },
    })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

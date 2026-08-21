import {
  inventoryErrorResponse,
  jsonOk,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { deleteRoleAssignment } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'

export async function DELETE(
  request: Request,
  route: { params: Promise<{ bitrixUserId: string }> },
) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const { bitrixUserId } = await route.params
    return jsonOk(await deleteRoleAssignment(context, bitrixUserId))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

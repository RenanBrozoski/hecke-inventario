import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { roleAssignmentSchema } from '@/src/modules/inventory/schemas'
import { listRoleAssignments, setRoleAssignment } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    return jsonOk({ items: await listRoleAssignments(context.portalId) })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const body = roleAssignmentSchema.parse(await parseJsonBody(request))
    return jsonOk(await setRoleAssignment(context, body))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

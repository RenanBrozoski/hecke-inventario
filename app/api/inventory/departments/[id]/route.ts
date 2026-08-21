import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { updateNamedResourceSchema } from '@/src/modules/inventory/schemas'
import { getDepartment, updateDepartment } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const { id } = await route.params
    return jsonOk(await getDepartment(portalId, id))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

async function setActive(
  request: Request,
  route: { params: Promise<{ id: string }> },
  active?: boolean,
) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const { id } = await route.params
    const body =
      active === undefined
        ? updateNamedResourceSchema.parse(await parseJsonBody(request))
        : { active }
    return jsonOk(await updateDepartment(context, id, body))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export const PATCH = (request: Request, route: { params: Promise<{ id: string }> }) =>
  setActive(request, route)
export const DELETE = (request: Request, route: { params: Promise<{ id: string }> }) =>
  setActive(request, route, false)

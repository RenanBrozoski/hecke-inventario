import { inventoryErrorResponse, jsonOk, requireInventoryContext } from '@/src/modules/inventory/http'
import { searchBitrixUsers } from '@/src/modules/bitrix/directory-search'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const params = new URL(request.url).searchParams
    const id = params.get('id')

    if (id) {
      const user = await prisma.bitrixUser.findFirst({ where: { bitrixUserId: id, portalId } })
      if (!user) return jsonOk(null)
      return jsonOk({ id: user.bitrixUserId, name: user.fullName, email: user.email ?? '' })
    }

    const q = params.get('q') ?? ''
    if (q.trim().length < 2) return jsonOk([])

    const { items } = await searchBitrixUsers({ portalId, search: q.trim(), activeOnly: true })
    return jsonOk(
      items.map((u) => ({
        id: u.bitrixUserId,
        name: u.fullName,
        email: u.email ?? '',
      })),
    )
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

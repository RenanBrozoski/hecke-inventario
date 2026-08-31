import { inventoryErrorResponse, jsonOk, requireInventoryContext } from '@/src/modules/inventory/http'
import { getBitrixUser, searchBitrixUsers } from '@/src/lib/bitrix24'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requireInventoryContext(request)
    const params = new URL(request.url).searchParams
    const id = params.get('id')
    if (id) {
      const user = await getBitrixUser(id)
      if (!user) return jsonOk(null)
      return jsonOk({ id: user.ID, name: `${user.NAME} ${user.LAST_NAME}`.trim(), email: user.EMAIL ?? '' })
    }
    const q = params.get('q') ?? ''
    if (q.trim().length < 2) return jsonOk([])
    const users = await searchBitrixUsers(q.trim())
    return jsonOk(
      users.map((u) => ({
        id: u.ID,
        name: `${u.NAME} ${u.LAST_NAME}`.trim(),
        email: u.EMAIL ?? '',
      })),
    )
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

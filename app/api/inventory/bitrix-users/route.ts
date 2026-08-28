import { inventoryErrorResponse, jsonOk, requireInventoryContext } from '@/src/modules/inventory/http'
import { searchBitrixUsers } from '@/src/lib/bitrix24'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requireInventoryContext(request)
    const q = new URL(request.url).searchParams.get('q') ?? ''
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

import { NextResponse } from 'next/server'
import { requireSession } from '@/src/modules/auth/require-session'
import { sessionErrorResponse } from '@/src/modules/auth/http'
import { searchBitrixUsers } from '@/src/modules/bitrix/directory-search'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { portal } = await requireSession(request)
    const url = new URL(request.url)

    const result = await searchBitrixUsers({
      portalId: portal.id,
      search: url.searchParams.get('search') ?? undefined,
      activeOnly: url.searchParams.get('activeOnly') !== 'false',
      page: url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined,
      pageSize: url.searchParams.get('pageSize') ? Number(url.searchParams.get('pageSize')) : undefined,
    })

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return sessionErrorResponse(error)
  }
}

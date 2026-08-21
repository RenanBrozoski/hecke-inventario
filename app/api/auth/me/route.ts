import { NextResponse } from 'next/server'
import { requireSession } from '@/src/modules/auth/require-session'
import { sessionErrorResponse } from '@/src/modules/auth/http'
import { isPortalAdministrator } from '@/src/modules/bitrix/admin'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { portal, user } = await requireSession(request)
    const admin = await isPortalAdministrator(portal.id, user.bitrixUserId)

    return NextResponse.json(
      {
        portal: { domain: portal.domain, status: portal.status },
        user: {
          bitrixUserId: user.bitrixUserId,
          fullName: user.fullName,
          isAdmin: admin,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return sessionErrorResponse(error)
  }
}

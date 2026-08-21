import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { requireSession } from '@/src/modules/auth/require-session'
import { sessionErrorResponse } from '@/src/modules/auth/http'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { portal } = await requireSession(request)

    const [usersCount, departmentsCount] = await Promise.all([
      prisma.bitrixUser.count({ where: { portalId: portal.id, active: true } }),
      prisma.bitrixDepartment.count({ where: { portalId: portal.id, active: true } }),
    ])

    return NextResponse.json(
      {
        syncStatus: portal.syncStatus,
        lastSyncAt: portal.lastSyncAt?.toISOString() ?? null,
        lastSyncErrorAt: portal.lastSyncErrorAt?.toISOString() ?? null,
        lastSyncErrorMessage: portal.lastSyncErrorMessage,
        usersCount,
        departmentsCount,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return sessionErrorResponse(error)
  }
}

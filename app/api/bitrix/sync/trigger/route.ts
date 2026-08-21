import { NextResponse } from 'next/server'
import { requireSession } from '@/src/modules/auth/require-session'
import { sessionErrorResponse } from '@/src/modules/auth/http'
import { isPortalAdministrator } from '@/src/modules/bitrix/admin'
import { inngest } from '@/src/lib/inngest/client'

export const dynamic = 'force-dynamic'

/** Só dispara o evento — quem processa é o job do Inngest (ver sync-bitrix-portal.ts). */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { portal, user } = await requireSession(request)

    const admin = await isPortalAdministrator(portal.id, user.bitrixUserId)
    if (!admin) {
      return NextResponse.json(
        { error: 'Apenas administradores podem disparar a sincronização.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    await inngest.send({ name: 'bitrix/portal.sync.requested', data: { portalId: portal.id } })

    return NextResponse.json({ triggered: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return sessionErrorResponse(error)
  }
}

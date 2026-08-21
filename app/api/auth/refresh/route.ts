import { NextResponse } from 'next/server'
import { requireSession } from '@/src/modules/auth/require-session'
import { sessionErrorResponse } from '@/src/modules/auth/http'
import { issueSessionToken } from '@/src/modules/auth/session'

export const dynamic = 'force-dynamic'

/**
 * Só renova uma sessão AINDA válida: requireSession() já rejeita (via
 * verifySessionToken) qualquer token com `exp` vencido — não existe tolerância,
 * não existe refresh token interno nesta fase. Se a sessão já expirou, a única
 * saída é reabrir o aplicativo pelo Bitrix24 (novo handshake).
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { portal, user } = await requireSession(request)
    const session = await issueSessionToken({
      portalId: portal.id,
      bitrixUserId: user.bitrixUserId,
      sessionVersion: portal.sessionVersion,
    })

    return NextResponse.json(
      { token: session.token, expiresAt: session.expiresAt.toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return sessionErrorResponse(error)
  }
}

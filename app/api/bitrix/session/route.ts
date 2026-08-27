import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { fetchCurrentUserWithContextToken } from '@/src/modules/bitrix/client'
import { bootstrapUserFromContext } from '@/src/modules/bitrix/bootstrap-user'
import { createHandshake } from '@/src/modules/auth/handshake'
import { logger } from '@/src/modules/common/logger'
import { extractClientIp, isRateLimited } from '@/src/modules/common/rate-limit'

export const dynamic = 'force-dynamic'

// Chamado pelo auth-bridge (BX24.js) com o token obtido client-side.
// Valida o token contra o domínio real do portal (não oauth.bitrix.info)
// e cria um handshake para abrir o app.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 120

export async function POST(request: Request): Promise<NextResponse> {
  const ip = extractClientIp(request)
  if (isRateLimited('bitrix-session', ip, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX)) {
    return NextResponse.json({ error: 'Muitas tentativas' }, { status: 429 })
  }

  let body: { accessToken?: string; memberId?: string; domain?: string; placement?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }

  const { accessToken, memberId, domain, placement } = body

  if (!accessToken || !memberId || !domain) {
    return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })
  }

  // Rejeita oauth.bitrix.info — o BX24.js deve devolver o domínio real do portal.
  if (domain === 'oauth.bitrix.info' || !domain.includes('.')) {
    return NextResponse.json({ error: 'Domínio inválido' }, { status: 400 })
  }

  const portal = await prisma.bitrixPortal.findUnique({ where: { memberId } })
  if (!portal || portal.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Portal não encontrado ou inativo' }, { status: 403 })
  }

  let currentUser
  try {
    currentUser = await fetchCurrentUserWithContextToken(domain, accessToken)
  } catch (error) {
    logger.error({ portalId: portal.id, domain, err: error }, 'session: falha ao validar token BX24.js')
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? 'N/A')
        : 'N/A'
    const detail = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: `Validação falhou [${code}: ${detail}]` }, { status: 401 })
  }

  if (currentUser.ACTIVE === false) {
    return NextResponse.json({ error: 'Usuário inativo no Bitrix24' }, { status: 403 })
  }

  await bootstrapUserFromContext(portal.id, currentUser)

  const handshakeCode = await createHandshake({
    portalId: portal.id,
    bitrixUserId: currentUser.ID,
    context: { placement: placement ?? null },
  })

  return NextResponse.json({ redirectUrl: `/bitrix/app?hs=${handshakeCode}` })
}

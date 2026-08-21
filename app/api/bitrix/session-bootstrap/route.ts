import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { BitrixCurrentUserContext } from '@/src/modules/bitrix/client'
import { bootstrapClientSession } from '@/src/modules/bitrix/launch'
import { logger } from '@/src/modules/common/logger'
import { extractClientIp, isRateLimited } from '@/src/modules/common/rate-limit'

export const dynamic = 'force-dynamic'

const SECURITY_HEADERS = { 'Cache-Control': 'no-store' }

// Chamado pelo próprio navegador do usuário, sem sessão prévia — janela
// generosa (é esperado 1 chamada por abertura do app), só pra conter abuso.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30

const bodySchema = z.object({
  auth: z.object({
    domain: z.string().min(1),
    member_id: z.string().min(1),
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    expires_in: z.number().optional(),
    scope: z.string().optional(),
  }),
  user: z
    .object({
      ID: z.string().min(1),
      ACTIVE: z.boolean().optional(),
      NAME: z.string().optional(),
      LAST_NAME: z.string().optional(),
      EMAIL: z.string().optional(),
      UF_DEPARTMENT: z.array(z.union([z.number(), z.string()])).optional(),
      WORK_POSITION: z.string().optional(),
    })
    .passthrough(),
  placement: z.string().nullable().optional(),
})

/**
 * Recebe o contexto que o SDK `bitrix24.js` resolveu no navegador
 * (BX24.getAuth() + BX24.callMethod('user.current')) e, se válido, emite um
 * handshake de uso único (trocado depois em /api/auth/exchange). Ver
 * src/modules/bitrix/launch.ts para o porquê deste fluxo existir em vez de
 * validar o AUTH_ID do POST de abertura diretamente no servidor.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const ip = extractClientIp(request)
  if (isRateLimited('session-bootstrap', ip, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX)) {
    return NextResponse.json({ error: 'Muitas tentativas. Tente novamente em instantes.' }, { status: 429, headers: SECURITY_HEADERS })
  }

  const rawBody = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados de contexto inválidos.' }, { status: 400, headers: SECURITY_HEADERS })
  }

  const { auth, user, placement } = parsed.data

  const result = await bootstrapClientSession({
    domain: auth.domain,
    memberId: auth.member_id,
    accessToken: auth.access_token,
    refreshToken: auth.refresh_token,
    expiresIn: auth.expires_in,
    scope: auth.scope,
    user: user as unknown as BitrixCurrentUserContext,
    placement: placement ?? null,
  })

  if (!result.ok) {
    logger.warn({ memberId: auth.member_id, message: result.message }, 'session-bootstrap: rejeitado')
    return NextResponse.json({ error: result.message }, { status: 401, headers: SECURITY_HEADERS })
  }

  return NextResponse.json({ code: result.handshakeCode }, { headers: SECURITY_HEADERS })
}

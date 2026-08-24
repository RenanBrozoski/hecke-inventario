import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/src/lib/prisma'
import { consumeHandshake } from '@/src/modules/auth/handshake'
import { issueSessionToken } from '@/src/modules/auth/session'
import { extractClientIp, isRateLimited } from '@/src/modules/common/rate-limit'

export const dynamic = 'force-dynamic'

const SECURITY_HEADERS = { 'Cache-Control': 'no-store' }

const bodySchema = z.object({ code: z.string().min(10).max(512) })

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 20

function genericInvalidResponse(): NextResponse {
  // Mesma mensagem/status sempre — nunca revela se o código existiu, expirou
  // ou já foi consumido.
  return NextResponse.json(
    { error: 'Código inválido ou expirado.' },
    { status: 401, headers: SECURITY_HEADERS },
  )
}

export async function POST(request: Request): Promise<NextResponse> {
  const ip = extractClientIp(request)
  if (isRateLimited('auth-exchange', ip, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX)) {
    return NextResponse.json(
      { error: 'Muitas tentativas. Tente novamente em instantes.' },
      { status: 429, headers: SECURITY_HEADERS },
    )
  }

  const rawBody = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Código inválido.' }, { status: 400, headers: SECURITY_HEADERS })
  }

  // Consumo atômico (ver handshake.ts) — impede que duas trocas simultâneas do
  // mesmo código emitam duas sessões.
  const consumed = await consumeHandshake(parsed.data.code)
  if (!consumed) {
    // DIAGNÓSTICO TEMPORÁRIO (remover depois): distingue hash/DB errados de
    // handshake expirado/já consumido. Só metadados — nunca o código.
    if (request.headers.get('x-debug-exchange') === '1') {
      const { createHash } = await import('crypto')
      const codeHash = createHash('sha256').update(parsed.data.code).digest('hex')
      const row = await prisma.bitrixHandshake.findUnique({
        where: { codeHash },
        select: { consumedAt: true, expiresAt: true, portalId: true },
      })
      const total = await prisma.bitrixHandshake.count()
      return NextResponse.json(
        {
          debug: true,
          hashPrefix: codeHash.slice(0, 12),
          rowFound: Boolean(row),
          consumedAt: row?.consumedAt ?? null,
          expiresAt: row?.expiresAt ?? null,
          now: new Date().toISOString(),
          totalHandshakes: total,
        },
        { status: 200, headers: SECURITY_HEADERS },
      )
    }
    return genericInvalidResponse()
  }

  const portal = await prisma.bitrixPortal.findUnique({ where: { id: consumed.portalId } })
  if (!portal || portal.status !== 'ACTIVE') {
    return genericInvalidResponse()
  }

  const session = await issueSessionToken({
    portalId: portal.id,
    bitrixUserId: consumed.bitrixUserId,
    sessionVersion: portal.sessionVersion,
  })

  return NextResponse.json(
    { token: session.token, expiresAt: session.expiresAt.toISOString() },
    { headers: SECURITY_HEADERS },
  )
}

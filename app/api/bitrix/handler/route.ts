import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { fetchCurrentUserWithContextToken } from '@/src/modules/bitrix/client'
import { bootstrapUserFromContext } from '@/src/modules/bitrix/bootstrap-user'
import { createHandshake } from '@/src/modules/auth/handshake'
import { logger } from '@/src/modules/common/logger'
import { extractClientIp, isRateLimited } from '@/src/modules/common/rate-limit'

export const dynamic = 'force-dynamic'

// Chamado a cada abertura do app por qualquer usuário do portal — janela bem
// generosa (tráfego legítimo pode vir concentrado de poucos IPs/proxy
// corporativo), só pra conter abuso grosseiro. Cada chamada dispara uma
// validação contra o Bitrix24 (custo de rede real).
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 120

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

function errorHtml(message: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>Não foi possível abrir o aplicativo</title></head><body><h1>Não foi possível abrir o aplicativo</h1><p>${message}</p></body></html>`,
    { status, headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

export async function POST(request: Request): Promise<NextResponse> {
  const ip = extractClientIp(request)
  if (isRateLimited('bitrix-handler', ip, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX)) {
    return errorHtml('Muitas tentativas. Tente novamente em instantes.', 429)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return errorHtml('Requisição inválida.', 400)
  }

  const domain = form.get('DOMAIN')?.toString()
  const memberId = form.get('member_id')?.toString()
  const authId = form.get('AUTH_ID')?.toString()

  if (!domain || !memberId || !authId) {
    return errorHtml('Dados de contexto incompletos.', 400)
  }

  const portal = await prisma.bitrixPortal.findUnique({ where: { memberId } })
  if (!portal) {
    return errorHtml('Portal não encontrado. Reinstale o aplicativo.')
  }
  if (portal.status !== 'ACTIVE') {
    return errorHtml(`A instalação não está ativa no momento (status: ${portal.status}).`)
  }

  // Prova de identidade: SEMPRE valida contra o Bitrix24, nunca confia nos
  // campos do formulário isoladamente. Este AUTH_ID é efêmero — usado só nesta
  // chamada, nunca persistido, nunca sobrescreve o token da instalação.
  let currentUser
  try {
    currentUser = await fetchCurrentUserWithContextToken(domain, authId)
  } catch (error) {
    logger.error({ portalId: portal.id, err: error }, 'handler: falha ao validar usuário com user.current')
    return errorHtml('Não foi possível validar sua identidade no Bitrix24.')
  }

  if (currentUser.ACTIVE === false) {
    return errorHtml('Seu usuário está inativo neste portal Bitrix24.')
  }

  // O domínio só é atualizado DEPOIS de uma validação bem-sucedida contra ele
  // mesmo — o Bitrix24 não devolveria um AUTH_ID válido para um domínio que não
  // fosse realmente o desta instalação.
  if (domain !== portal.domain) {
    logger.warn(
      { portalId: portal.id, oldDomain: portal.domain, newDomain: domain },
      'handler: domínio do portal mudou, atualizando após validação bem-sucedida',
    )
    await prisma.bitrixPortal.update({ where: { id: portal.id }, data: { domain } })
  }

  // Resolve a corrida entre "primeira abertura" e "sync completo ainda não
  // terminou": o usuário já validado agora mesmo via user.current fica
  // disponível localmente na hora, sem esperar o Inngest. O sync completo
  // continua responsável por complementar (departamentos, gestor) e por
  // manter todo o resto da base atualizado.
  await bootstrapUserFromContext(portal.id, currentUser)

  const handshakeCode = await createHandshake({
    portalId: portal.id,
    bitrixUserId: currentUser.ID,
    context: { placement: form.get('PLACEMENT')?.toString() ?? null },
  })

  const redirectUrl = new URL('/bitrix/app', request.url)
  redirectUrl.searchParams.set('hs', handshakeCode)

  return NextResponse.redirect(redirectUrl, { status: 303, headers: SECURITY_HEADERS })
}

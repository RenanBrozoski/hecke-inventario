import { NextResponse } from 'next/server'
import { fetchCurrentUserWithContextToken } from '@/src/modules/bitrix/client'
import { activatePortal, upsertPortalOnInstall } from '@/src/modules/bitrix/portal-credentials'
import { invalidateHandshakesForPortal } from '@/src/modules/auth/handshake'
import { maskSecret } from '@/src/modules/bitrix/crypto'
import { inngest } from '@/src/lib/inngest/client'
import { logger } from '@/src/modules/common/logger'
import { extractClientIp, isRateLimited } from '@/src/modules/common/rate-limit'

export const dynamic = 'force-dynamic'

// Instalação é rara por natureza — janela curta e limite baixo, cada chamada
// aqui já dispara uma validação contra o Bitrix24 (custo de rede real).
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 10

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

function htmlResponse(html: string, status = 200): NextResponse {
  return new NextResponse(html, {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// Confirmado na documentação oficial do Bitrix24 (ver mensagem anterior, item 3):
// para app local COM interface, este endpoint roda em contexto de navegador
// (carregado num slider da própria interface do Bitrix24) — BX24.installFinish()
// só funciona chamado a partir daqui, nunca de um callback servidor-a-servidor.
function installSuccessHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8" /><title>Instalando Portal de Solicitações</title></head>
<body>
<p>Instalação concluída — você já pode fechar esta janela.</p>
<script src="https://api.bitrix24.com/api/v1/"></script>
<script>
  BX24.init(function () {
    BX24.installFinish();
  });
</script>
</body>
</html>`
}

function installErrorHtml(message: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8" /><title>Erro na instalação</title></head>
<body>
<h1>Não foi possível concluir a instalação</h1>
<p>${message}</p>
<p>Verifique as configurações do aplicativo no Bitrix24 e tente instalar novamente.</p>
</body>
</html>`
}

export async function POST(request: Request): Promise<NextResponse> {
  const ip = extractClientIp(request)
  if (isRateLimited('bitrix-install', ip, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX)) {
    return htmlResponse(installErrorHtml('Muitas tentativas. Tente novamente em instantes.'), 429)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return htmlResponse(installErrorHtml('Requisição inválida (payload ilegível).'), 400)
  }

  const domain = form.get('DOMAIN')?.toString()
  const memberId = form.get('member_id')?.toString()
  const authId = form.get('AUTH_ID')?.toString()
  const refreshId = form.get('REFRESH_ID')?.toString()
  const authExpires = form.get('AUTH_EXPIRES')?.toString()
  // O Bitrix24 não garante um campo de escopo pronto no payload de instalação;
  // tentamos ler mesmo assim, mas não presumimos que virá preenchido.
  const scopeRaw = form.get('SCOPE')?.toString()

  if (!domain || !memberId || !authId || !refreshId) {
    logger.warn(
      { hasDomain: Boolean(domain), hasMemberId: Boolean(memberId), hasAuthId: Boolean(authId) },
      'install: payload incompleto',
    )
    return htmlResponse(installErrorHtml('Dados de instalação incompletos.'), 400)
  }

  // Validação obrigatória ANTES de qualquer persistência: nunca confiamos nos
  // campos do payload sozinhos, só na resposta autenticada do próprio Bitrix24.
  let currentUser
  try {
    currentUser = await fetchCurrentUserWithContextToken(domain, authId)
  } catch (error) {
    logger.error({ domain, memberId, err: error }, 'install: falha ao validar AUTH_ID com user.current')
    return htmlResponse(installErrorHtml('Não foi possível validar as credenciais recebidas do Bitrix24.'))
  }

  if (currentUser.ACTIVE === false) {
    return htmlResponse(installErrorHtml('O usuário que iniciou a instalação está inativo no Bitrix24.'))
  }

  const expiresAt = new Date(Date.now() + Number(authExpires ?? 3600) * 1000)
  const scopes = scopeRaw
    ? scopeRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  let portal
  try {
    // Upsert por memberId (idempotente — reinstalar não duplica nem corrompe),
    // sempre volta como PENDING; só promovemos para ACTIVE logo abaixo, depois
    // de confirmar que a persistência funcionou.
    portal = await upsertPortalOnInstall({
      domain,
      memberId,
      accessToken: authId,
      refreshToken: refreshId,
      expiresAt,
      scopes,
      installedByBitrixUserId: currentUser.ID,
      installedAt: new Date(),
    })
    portal = await activatePortal(portal.id)
  } catch (error) {
    logger.error({ domain, memberId, err: error }, 'install: falha ao persistir BitrixPortal')
    return htmlResponse(installErrorHtml('Falha interna ao registrar a instalação.'), 500)
  }

  logger.info(
    { portalId: portal.id, domain, memberId, contextToken: maskSecret(authId) },
    'install: portal ativado',
  )

  // Higiene de segurança em toda (re)instalação: nenhum handshake emitido antes
  // dela continua valendo (item 5 da estabilização).
  await invalidateHandshakesForPortal(portal.id).catch((error) => {
    logger.error({ portalId: portal.id, err: error }, 'install: falha ao invalidar handshakes antigos')
  })

  // Sincronização inicial disparada via Inngest, mas NÃO aguardada — não deve
  // bloquear a conclusão da instalação (ver Bloco 7).
  await inngest
    .send({ name: 'bitrix/portal.sync.requested', data: { portalId: portal.id } })
    .catch((error) => {
      logger.error({ portalId: portal.id, err: error }, 'install: falha ao agendar sincronização inicial')
    })

  return htmlResponse(installSuccessHtml())
}

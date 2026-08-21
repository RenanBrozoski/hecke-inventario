import { prisma } from '@/src/lib/prisma'
import type { BitrixCurrentUserContext } from '@/src/modules/bitrix/client'
import { bootstrapUserFromContext } from '@/src/modules/bitrix/bootstrap-user'
import { activatePortal, upsertPortalOnInstall } from '@/src/modules/bitrix/portal-credentials'
import { invalidateHandshakesForPortal, createHandshake } from '@/src/modules/auth/handshake'
import { inngest } from '@/src/lib/inngest/client'
import { logger } from '@/src/modules/common/logger'

export type BitrixLaunchResult = { ok: true; handshakeCode: string } | { ok: false; message: string; status: number }

const DEFAULT_TOKEN_TTL_MS = 3600 * 1000
const MAX_REASONABLE_TTL_SECONDS = 60 * 60 * 24 * 365 // 1 ano

/**
 * `BX24.getAuth().expires_in`, apesar do nome e da documentação oficial, veio
 * na prática como um timestamp absoluto em milissegundos (bem próximo de
 * `Date.now()`), não como uma duração relativa em segundos — tratando-o como
 * duração e multiplicando por 1000 de novo, a data de expiração explode para
 * o ano 58596 e o Prisma rejeita o valor. Se o número já é grande demais para
 * ser uma duração razoável em segundos, assumimos que é o timestamp absoluto.
 */
function resolveExpiresAt(expiresIn?: number): Date {
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return new Date(Date.now() + DEFAULT_TOKEN_TTL_MS)
  }
  if (expiresIn > MAX_REASONABLE_TTL_SECONDS) {
    return new Date(expiresIn)
  }
  return new Date(Date.now() + expiresIn * 1000)
}

export interface ClientBootstrapInput {
  domain: string
  memberId: string
  accessToken: string
  refreshToken: string
  expiresIn?: number
  scope?: string
  user: BitrixCurrentUserContext
  placement?: string | null
}

/**
 * Estabelece a sessão a partir do contexto que o SDK `bitrix24.js` resolveu
 * DENTRO do iframe real do Bitrix24 (BX24.init() + BX24.getAuth() +
 * BX24.callMethod('user.current')) — nunca a partir do POST bruto que o
 * Bitrix24 envia para a "URL inicial" na abertura do app.
 *
 * Por quê: chamar `user.current`/`profile` no servidor com o AUTH_ID desse
 * POST bruto retorna consistentemente ACCESS_DENIED ("User authorization
 * required") neste portal, mesmo com o escopo `user` completo concedido —
 * mas a mesma chamada funciona quando feita pelo SDK no navegador (o
 * handshake via postMessage com a janela pai do Bitrix24 dá ao token um nível
 * de sessão que a chamada servidor-a-servidor não tem). Confirmado
 * comparando com uma integração Bitrix24 anterior que já funcionava em
 * produção: ela também resolve `user.current` client-side via BX24.js, nunca
 * server-side com o token do POST.
 *
 * O SDK só devolve um `user` real quando `BX24.init()` de fato completou o
 * handshake com o Bitrix24 — por isso confiamos no `user`/`auth` recebidos
 * aqui do mesmo jeito que a integração de referência confia.
 */
export async function bootstrapClientSession(input: ClientBootstrapInput): Promise<BitrixLaunchResult> {
  const { domain, memberId, user } = input

  if (user.ACTIVE === false) {
    return { ok: false, message: 'Seu usuário está inativo neste portal Bitrix24.', status: 200 }
  }

  let portal = await prisma.bitrixPortal.findUnique({ where: { memberId } })

  if (!portal) {
    const scopes = input.scope
      ? input.scope
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : []

    portal = await upsertPortalOnInstall({
      domain,
      memberId,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      expiresAt: resolveExpiresAt(input.expiresIn),
      scopes,
      installedByBitrixUserId: user.ID,
      installedAt: new Date(),
    })
    portal = await activatePortal(portal.id)

    await invalidateHandshakesForPortal(portal.id).catch((error) => {
      logger.error({ portalId: portal!.id, err: error }, 'session-bootstrap: falha ao invalidar handshakes antigos')
    })
    await inngest
      .send({ name: 'bitrix/portal.sync.requested', data: { portalId: portal.id } })
      .catch((error) => {
        logger.error({ portalId: portal!.id, err: error }, 'session-bootstrap: falha ao agendar sincronização inicial')
      })

    logger.info({ portalId: portal.id, domain, memberId }, 'session-bootstrap: portal criado e ativado na primeira abertura')
  } else if (portal.status !== 'ACTIVE') {
    return { ok: false, message: `A instalação não está ativa no momento (status: ${portal.status}).`, status: 200 }
  } else if (domain !== portal.domain) {
    logger.warn(
      { portalId: portal.id, oldDomain: portal.domain, newDomain: domain },
      'session-bootstrap: domínio do portal mudou, atualizando',
    )
    portal = await prisma.bitrixPortal.update({ where: { id: portal.id }, data: { domain } })
  }

  // Resolve a corrida entre "primeira abertura" e "sync completo ainda não
  // terminou": o usuário já resolvido agora mesmo pelo SDK fica disponível
  // localmente na hora, sem esperar o Inngest.
  await bootstrapUserFromContext(portal.id, user)

  const handshakeCode = await createHandshake({
    portalId: portal.id,
    bitrixUserId: user.ID,
    context: { placement: input.placement ?? null },
  })

  return { ok: true, handshakeCode }
}

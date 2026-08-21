import { prisma } from '@/src/lib/prisma'
import { logger } from '@/src/modules/common/logger'
import { decryptPortalTokens, savePortalTokens } from './portal-credentials'

const OAUTH_TOKEN_URL = 'https://oauth.bitrix.info/oauth/token/'

// Códigos de erro do Bitrix24 tratados como transitórios (vale tentar de novo).
// Qualquer outro `error` é considerado definitivo (erro de negócio/parâmetro).
const TRANSIENT_ERROR_CODES = new Set(['QUERY_LIMIT_EXCEEDED', 'INTERNAL_SERVER_ERROR', 'ServiceUnavailable'])

export class BitrixApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly transient = false,
  ) {
    super(message)
    this.name = 'BitrixApiError'
  }
}

interface CallOptions {
  /** true (default) = método de leitura, pode repetir em erro transitório.
   *  false = ação com efeito colateral não idempotente — nunca repetida automaticamente. */
  idempotent?: boolean
  timeoutMs?: number
  maxRetries?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: Date
}> {
  const clientId = process.env.BITRIX_CLIENT_ID
  const clientSecret = process.env.BITRIX_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('BITRIX_CLIENT_ID/BITRIX_CLIENT_SECRET não configurados')
  }

  const url = new URL(OAUTH_TOKEN_URL)
  url.searchParams.set('grant_type', 'refresh_token')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('client_secret', clientSecret)
  url.searchParams.set('refresh_token', refreshToken)

  const response = await fetchWithTimeout(url.toString(), { method: 'GET' }, 10_000)
  const data = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }

  if (!response.ok || !data.access_token || !data.refresh_token) {
    throw new Error(data.error_description ?? data.error ?? 'Falha ao renovar o token do Bitrix24')
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
  }
}

export interface BitrixListEnvelope<T> {
  result: T
  next?: number
  total?: number
}

/**
 * Núcleo único de chamada à API REST do Bitrix24 usando a credencial da
 * INSTALAÇÃO (persistida em BitrixPortal) — nenhum outro módulo deve usar
 * `fetch` diretamente para isso. Cuida de: autenticação, detecção/renovação de
 * token expirado (repete a chamada original só uma vez após renovar), timeout
 * e retry apenas em erro transitório e apenas quando `idempotent !== false`.
 * Retorna o envelope completo (inclusive `next`/`total`) para permitir paginação;
 * `callBitrixMethod` e `paginateBitrixList` abaixo são wrappers finos sobre isto.
 */
async function callBitrixRaw<T = unknown>(
  portalId: string,
  method: string,
  params: Record<string, unknown> = {},
  options: CallOptions = {},
): Promise<BitrixListEnvelope<T>> {
  const { idempotent = true, timeoutMs = 10_000, maxRetries = 3 } = options

  const portal = await prisma.bitrixPortal.findUniqueOrThrow({ where: { id: portalId } })
  if (portal.status === 'TOKEN_INVALID' || portal.status === 'UNINSTALLED') {
    throw new BitrixApiError(
      `Portal ${portal.domain} não está apto para chamadas REST (status ${portal.status})`,
      'PORTAL_NOT_READY',
    )
  }

  let accessToken = decryptPortalTokens(portal).accessToken
  let refreshedOnce = false
  let retryCount = 0

  // Limite duro de iterações (1 renovação de token + maxRetries tentativas
  // transitórias) — nunca um laço realmente infinito.
  for (let iteration = 0; iteration < maxRetries + 2; iteration += 1) {
    let data: { result?: T; next?: number; total?: number; error?: string; error_description?: string }

    try {
      const response = await fetchWithTimeout(
        `https://${portal.domain}/rest/${method}.json`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, auth: accessToken }),
        },
        timeoutMs,
      )
      data = await response.json()
    } catch (error) {
      if (idempotent && retryCount < maxRetries) {
        retryCount += 1
        await sleep(2 ** retryCount * 200)
        continue
      }
      throw new BitrixApiError(
        `Falha de comunicação com ${portal.domain}: ${error instanceof Error ? error.message : String(error)}`,
        'NETWORK_ERROR',
        true,
      )
    }

    if (data.error === 'expired_token' && !refreshedOnce) {
      refreshedOnce = true
      try {
        const { refreshToken } = decryptPortalTokens(portal)
        const refreshed = await refreshAccessToken(refreshToken)
        await savePortalTokens(portal.id, refreshed)
        accessToken = refreshed.accessToken
        continue
      } catch (refreshError) {
        const message = refreshError instanceof Error ? refreshError.message : 'Falha ao renovar token'
        await prisma.bitrixPortal.update({
          where: { id: portal.id },
          data: {
            status: 'TOKEN_INVALID',
            lastSyncErrorAt: new Date(),
            lastSyncErrorMessage: message.slice(0, 500),
          },
        })
        logger.error({ portalId: portal.id, err: refreshError }, 'falha ao renovar token do Bitrix24')
        throw new BitrixApiError(message, 'TOKEN_INVALID')
      }
    }

    if (data.error) {
      const transient = TRANSIENT_ERROR_CODES.has(data.error)
      if (transient && idempotent && retryCount < maxRetries) {
        retryCount += 1
        await sleep(2 ** retryCount * 200)
        continue
      }
      throw new BitrixApiError(data.error_description ?? data.error, data.error, transient)
    }

    return { result: data.result as T, next: data.next, total: data.total }
  }

  throw new BitrixApiError(`Número máximo de tentativas excedido chamando ${method}`, 'MAX_RETRIES_EXCEEDED')
}

/** Chama um método que devolve um único resultado (não uma lista paginada). */
export async function callBitrixMethod<T = unknown>(
  portalId: string,
  method: string,
  params: Record<string, unknown> = {},
  options: CallOptions = {},
): Promise<T> {
  const envelope = await callBitrixRaw<T>(portalId, method, params, options)
  return envelope.result
}

/**
 * Percorre todas as páginas de um método de listagem do Bitrix24 (ex.: user.get,
 * department.get), usando o `next` devolvido pelo próprio Bitrix24 como offset
 * da página seguinte, até não haver mais páginas.
 */
export async function paginateBitrixList<T>(
  portalId: string,
  method: string,
  baseParams: Record<string, unknown> = {},
  options: CallOptions = {},
): Promise<T[]> {
  const items: T[] = []
  let start: number | undefined = 0

  while (start !== undefined) {
    const currentStart: number = start
    const envelope: BitrixListEnvelope<T[]> = await callBitrixRaw<T[]>(
      portalId,
      method,
      { ...baseParams, start: currentStart },
      options,
    )
    items.push(...(envelope.result ?? []))
    start = envelope.next
  }

  return items
}

export interface BitrixCurrentUserContext {
  ID: string
  NAME?: string
  LAST_NAME?: string
  EMAIL?: string
  ACTIVE?: boolean
  UF_DEPARTMENT?: number[]
  WORK_POSITION?: string
  [key: string]: unknown
}

/**
 * Valida o AUTH_ID recebido na abertura do app (handler), chamando `profile`
 * DIRETAMENTE com esse token contextual — nunca com o token persistido da
 * instalação. É assim que a separação de credenciais é garantida: este token de
 * quem abriu o app nunca é salvo em BitrixPortal, só usado nesta única chamada
 * para provar identidade.
 *
 * Usa `profile`, não `user.current`: `user.current` exige o escopo `user`
 * completo (não `user_basic`/`user_brief`) e ainda assim retornou
 * ERROR_METHOD_NOT_FOUND em testes reais contra um portal de produção — `profile`
 * é o método documentado do Bitrix24 para "quem é o usuário deste contexto" e
 * funciona com qualquer token de sessão válido, sem exigir escopo elevado.
 */
export async function fetchCurrentUserWithContextToken(
  domain: string,
  authId: string,
): Promise<BitrixCurrentUserContext> {
  const response = await fetchWithTimeout(
    `https://${domain}/rest/profile.json`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth: authId }),
    },
    10_000,
  )

  const data = (await response.json()) as {
    result?: BitrixCurrentUserContext
    error?: string
    error_description?: string
  }

  if (data.error || !data.result) {
    throw new BitrixApiError(
      data.error_description ?? data.error ?? 'Não foi possível validar o usuário no Bitrix24',
      data.error ?? 'INVALID_CONTEXT_TOKEN',
    )
  }

  return data.result
}

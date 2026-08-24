import { hkdfSync, randomUUID } from 'crypto'
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose'

const ISSUER = 'formularios-bitrix'
const AUDIENCE = 'formularios-bitrix:app'
// TTL dentro da janela pedida (20-30 min). Não há tolerância para exp vencido —
// ver require-session.ts / rota /api/auth/refresh: uma sessão expirada não pode
// ser renovada, só reaberta via Bitrix24.
const SESSION_TTL_SECONDS = 25 * 60

// Rótulo de separação de domínio do HKDF: garante que a chave de assinatura
// derivada NUNCA seja igual à BITRIX_TOKEN_ENCRYPTION_KEY usada para cifrar os
// tokens do Bitrix24 — mesmo material de origem, finalidades criptográficas
// distintas.
const SESSION_KEY_HKDF_INFO = 'inventory-session-jwt-hs256'

function getSecretKey(): Uint8Array {
  // Preferência: um segredo dedicado, se configurado.
  const secret = process.env.SESSION_JWT_SECRET
  if (secret && secret.length >= 16) {
    return new TextEncoder().encode(secret)
  }

  // Fallback: derivar de BITRIX_TOKEN_ENCRYPTION_KEY (também segredo do
  // servidor, no mesmo cofre de variáveis). Isso elimina uma variável
  // obrigatória que, esquecida vazia, derruba TODA a autenticação em silêncio
  // — /api/auth/exchange consumia o handshake e só então estourava 500 aqui,
  // aparecendo na tela apenas como "não foi possível estabelecer a sessão".
  const encKeyRaw = process.env.BITRIX_TOKEN_ENCRYPTION_KEY
  if (encKeyRaw) {
    const ikm = Buffer.from(encKeyRaw, 'base64')
    if (ikm.length >= 16) {
      return new Uint8Array(hkdfSync('sha256', ikm, new Uint8Array(0), SESSION_KEY_HKDF_INFO, 32))
    }
  }

  throw new Error(
    'Nenhum segredo disponível para assinar a sessão: configure SESSION_JWT_SECRET ' +
      '(16+ caracteres) ou BITRIX_TOKEN_ENCRYPTION_KEY (base64 de 16+ bytes).',
  )
}

export interface SessionPayload {
  jti: string
  portalId: string
  bitrixUserId: string
  /** Espelha BitrixPortal.sessionVersion no momento da emissão — ver require-session.ts. */
  sessionVersion: number
}

export interface IssuedSession {
  token: string
  expiresAt: Date
  jti: string
}

/**
 * Emite a sessão interna: JWT curto, assinado, contendo só os identificadores
 * necessários (jti/portalId/bitrixUserId/sessionVersion) — nunca tokens do
 * Bitrix24, nunca nome/e-mail/CPF ou qualquer outro dado pessoal.
 *
 * `sessionVersion` precisa ser o valor ATUAL de `BitrixPortal.sessionVersion`
 * (lido do banco pelo chamador) — é o que permite revogar de uma vez todas as
 * sessões emitidas antes de uma reinstalação/incidente (ver require-session.ts).
 */
export async function issueSessionToken(payload: {
  portalId: string
  bitrixUserId: string
  sessionVersion: number
}): Promise<IssuedSession> {
  const jti = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const exp = now + SESSION_TTL_SECONDS

  const token = await new SignJWT({
    portalId: payload.portalId,
    bitrixUserId: payload.bitrixUserId,
    sessionVersion: payload.sessionVersion,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(getSecretKey())

  return { token, expiresAt: new Date(exp * 1000), jti }
}

export class SessionValidationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'MISSING'
      | 'MALFORMED'
      | 'EXPIRED'
      | 'INVALID'
      | 'PORTAL_INACTIVE'
      | 'USER_INACTIVE'
      | 'STALE_SESSION',
  ) {
    super(message)
    this.name = 'SessionValidationError'
  }
}

/**
 * Só verifica assinatura, issuer, audience e expiração (jose lança automaticamente
 * em token vencido — nunca ignoramos `exp`). Não reconsulta portal/usuário no
 * banco nem compara `sessionVersion` contra o valor atual — isso é
 * responsabilidade de requireSession(), que compõe esta função.
 */
export async function verifySessionToken(token: string): Promise<SessionPayload> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    })

    if (
      typeof payload.portalId !== 'string' ||
      typeof payload.bitrixUserId !== 'string' ||
      typeof payload.jti !== 'string' ||
      typeof payload.sessionVersion !== 'number'
    ) {
      throw new SessionValidationError('Sessão com formato inválido.', 'MALFORMED')
    }

    return {
      jti: payload.jti,
      portalId: payload.portalId,
      bitrixUserId: payload.bitrixUserId,
      sessionVersion: payload.sessionVersion,
    }
  } catch (error) {
    if (error instanceof SessionValidationError) throw error
    if (error instanceof joseErrors.JWTExpired) {
      throw new SessionValidationError('Sessão expirada.', 'EXPIRED')
    }
    throw new SessionValidationError('Sessão inválida.', 'INVALID')
  }
}

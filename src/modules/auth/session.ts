import { randomUUID } from 'crypto'
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose'

const ISSUER = 'formularios-bitrix'
const AUDIENCE = 'formularios-bitrix:app'
// TTL dentro da janela pedida (20-30 min). Não há tolerância para exp vencido —
// ver require-session.ts / rota /api/auth/refresh: uma sessão expirada não pode
// ser renovada, só reaberta via Bitrix24.
const SESSION_TTL_SECONDS = 25 * 60

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_JWT_SECRET
  if (!secret || secret.length < 16) {
    throw new Error(
      'SESSION_JWT_SECRET não configurada (ou curta demais) — necessária para assinar a sessão interna.',
    )
  }
  return new TextEncoder().encode(secret)
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

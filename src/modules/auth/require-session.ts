import type { BitrixPortal, BitrixUser } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { SessionValidationError, verifySessionToken } from './session'

export interface AuthContext {
  portal: BitrixPortal
  user: BitrixUser
  jti: string
}

/**
 * Helper centralizado usado por toda rota protegida: valida assinatura, issuer,
 * audience e expiração do JWT (via verifySessionToken) e, além disso, revalida
 * ao vivo que o portal continua ACTIVE e que o usuário local (espelho do
 * Bitrix24) continua existindo e ativo. Lança SessionValidationError em
 * qualquer caso de falha — o caller decide a resposta HTTP (ver http.ts).
 */
export async function requireSession(request: Request): Promise<AuthContext> {
  const header = request.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null
  if (!token) {
    throw new SessionValidationError('Cabeçalho Authorization ausente.', 'MISSING')
  }

  const payload = await verifySessionToken(token)

  const portal = await prisma.bitrixPortal.findUnique({ where: { id: payload.portalId } })
  if (!portal || portal.status !== 'ACTIVE') {
    throw new SessionValidationError('Portal não está ativo.', 'PORTAL_INACTIVE')
  }

  // Revogação em massa: uma reinstalação (ou, no futuro, uma desativação/incidente)
  // incrementa BitrixPortal.sessionVersion — qualquer sessão emitida com uma
  // versão antiga para de ser aceita, sem precisar armazenar cada sessão.
  if (payload.sessionVersion !== portal.sessionVersion) {
    throw new SessionValidationError('Sessão de uma versão anterior — não é mais válida.', 'STALE_SESSION')
  }

  const user = await prisma.bitrixUser.findUnique({
    where: { portalId_bitrixUserId: { portalId: payload.portalId, bitrixUserId: payload.bitrixUserId } },
  })
  if (!user || !user.active) {
    throw new SessionValidationError('Usuário não encontrado ou inativo.', 'USER_INACTIVE')
  }

  return { portal, user, jti: payload.jti }
}

import { SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { issueSessionToken, SessionValidationError, verifySessionToken } from './session'

describe('session (Bloco 6)', () => {
  const ORIGINAL_SECRET = process.env.SESSION_JWT_SECRET

  beforeEach(() => {
    process.env.SESSION_JWT_SECRET = 'segredo-de-teste-com-mais-de-16-caracteres'
  })

  afterEach(() => {
    process.env.SESSION_JWT_SECRET = ORIGINAL_SECRET
  })

  it('emite um JWT válido contendo jti, portalId, bitrixUserId e sessionVersion, e verifica com sucesso', async () => {
    const session = await issueSessionToken({ portalId: 'portal-1', bitrixUserId: 'user-1', sessionVersion: 3 })

    expect(session.token).toEqual(expect.any(String))
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const payload = await verifySessionToken(session.token)
    expect(payload).toEqual({
      jti: session.jti,
      portalId: 'portal-1',
      bitrixUserId: 'user-1',
      sessionVersion: 3,
    })
  })

  it('rejeita um JWT expirado', async () => {
    const key = new TextEncoder().encode(process.env.SESSION_JWT_SECRET)
    const now = Math.floor(Date.now() / 1000)

    const expiredToken = await new SignJWT({ portalId: 'portal-1', bitrixUserId: 'user-1', sessionVersion: 1 })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti('jti-expirado')
      .setIssuedAt(now - 3600)
      .setExpirationTime(now - 60)
      .setIssuer('formularios-bitrix')
      .setAudience('formularios-bitrix:app')
      .sign(key)

    await expect(verifySessionToken(expiredToken)).rejects.toMatchObject({ code: 'EXPIRED' })
  })

  it('rejeita audience inválida', async () => {
    const key = new TextEncoder().encode(process.env.SESSION_JWT_SECRET)
    const now = Math.floor(Date.now() / 1000)

    const wrongAudienceToken = await new SignJWT({ portalId: 'portal-1', bitrixUserId: 'user-1', sessionVersion: 1 })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti('jti-audience-errada')
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .setIssuer('formularios-bitrix')
      .setAudience('outro-publico-qualquer')
      .sign(key)

    await expect(verifySessionToken(wrongAudienceToken)).rejects.toBeInstanceOf(SessionValidationError)
  })

  it('rejeita um token assinado com outra chave', async () => {
    const wrongKey = new TextEncoder().encode('outra-chave-completamente-diferente-32b')
    const now = Math.floor(Date.now() / 1000)

    const tokenSignedWithWrongKey = await new SignJWT({
      portalId: 'portal-1',
      bitrixUserId: 'user-1',
      sessionVersion: 1,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti('jti-chave-errada')
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .setIssuer('formularios-bitrix')
      .setAudience('formularios-bitrix:app')
      .sign(wrongKey)

    await expect(verifySessionToken(tokenSignedWithWrongKey)).rejects.toBeInstanceOf(SessionValidationError)
  })
})

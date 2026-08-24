import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'crypto'
import { issueSessionToken, verifySessionToken } from './session'

// A chave de criptografia de token do Bitrix é base64 de 32 bytes.
const ENC_KEY = randomBytes(32).toString('base64')

describe('sessão sem SESSION_JWT_SECRET (fallback via BITRIX_TOKEN_ENCRYPTION_KEY)', () => {
  const ORIGINAL_SECRET = process.env.SESSION_JWT_SECRET
  const ORIGINAL_ENC = process.env.BITRIX_TOKEN_ENCRYPTION_KEY

  beforeEach(() => {
    delete process.env.SESSION_JWT_SECRET
    process.env.BITRIX_TOKEN_ENCRYPTION_KEY = ENC_KEY
  })
  afterEach(() => {
    process.env.SESSION_JWT_SECRET = ORIGINAL_SECRET
    process.env.BITRIX_TOKEN_ENCRYPTION_KEY = ORIGINAL_ENC
  })

  it('emite e valida um token mesmo sem SESSION_JWT_SECRET', async () => {
    const { token } = await issueSessionToken({
      portalId: 'portal-1',
      bitrixUserId: '355',
      sessionVersion: 1,
    })
    const payload = await verifySessionToken(token)
    expect(payload.portalId).toBe('portal-1')
    expect(payload.bitrixUserId).toBe('355')
  })

  it('a chave derivada NÃO é a própria chave de criptografia (separação de domínio)', async () => {
    // Um token assinado com a chave derivada não pode validar contra a chave de
    // criptografia crua — se validasse, as duas finalidades compartilhariam chave.
    const { token } = await issueSessionToken({
      portalId: 'p',
      bitrixUserId: 'u',
      sessionVersion: 1,
    })
    const { jwtVerify } = await import('jose')
    await expect(jwtVerify(token, Buffer.from(ENC_KEY, 'base64'))).rejects.toBeTruthy()
  })

  it('sem NENHUM segredo, lança erro claro', async () => {
    delete process.env.BITRIX_TOKEN_ENCRYPTION_KEY
    await expect(
      issueSessionToken({ portalId: 'p', bitrixUserId: 'u', sessionVersion: 1 }),
    ).rejects.toThrow(/Nenhum segredo disponível/)
  })
})

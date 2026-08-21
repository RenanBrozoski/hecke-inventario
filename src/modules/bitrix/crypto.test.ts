import { randomBytes } from 'crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, maskSecret } from './crypto'

describe('crypto (tokens do Bitrix24)', () => {
  const ORIGINAL_KEY = process.env.BITRIX_TOKEN_ENCRYPTION_KEY

  beforeEach(() => {
    process.env.BITRIX_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  })

  afterEach(() => {
    process.env.BITRIX_TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY
  })

  it('faz o roundtrip de um segredo corretamente', () => {
    const plaintext = 'access-token-de-teste-com-valor-fake'
    const encrypted = encryptSecret(plaintext)
    expect(encrypted).not.toContain(plaintext)
    expect(decryptSecret(encrypted)).toBe(plaintext)
  })

  it('gera saídas diferentes para o mesmo texto (IV aleatório)', () => {
    const plaintext = 'mesmo-valor'
    const first = encryptSecret(plaintext)
    const second = encryptSecret(plaintext)
    expect(first).not.toBe(second)
    expect(decryptSecret(first)).toBe(plaintext)
    expect(decryptSecret(second)).toBe(plaintext)
  })

  it('rejeita um valor adulterado (auth tag não bate)', () => {
    const encrypted = encryptSecret('valor-sensivel')
    const [version, iv, authTag, ciphertext] = encrypted.split('.')
    const tampered = [version, iv, authTag, `${ciphertext ?? ''}`.slice(0, -2) + 'aa'].join('.')
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('lança erro claro quando a chave de criptografia não está configurada', () => {
    delete process.env.BITRIX_TOKEN_ENCRYPTION_KEY
    expect(() => encryptSecret('qualquer-coisa')).toThrow(/BITRIX_TOKEN_ENCRYPTION_KEY/)
  })

  it('mascara segredos para uso em diagnóstico/logs', () => {
    expect(maskSecret(undefined)).toBe('(vazio)')
    expect(maskSecret('abc')).toBe('••••••')
    expect(maskSecret('1234567890abcdef')).toBe('1234••••cdef')
  })
})

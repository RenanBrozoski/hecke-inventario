import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const FORMAT_VERSION = 'v1'

function loadKey(): Buffer {
  const raw = process.env.BITRIX_TOKEN_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'BITRIX_TOKEN_ENCRYPTION_KEY não configurada — necessária para (des)criptografar tokens do Bitrix24.',
    )
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(
      'BITRIX_TOKEN_ENCRYPTION_KEY inválida — precisa decodificar (base64) para exatamente 32 bytes.',
    )
  }
  return key
}

/** Criptografa com AES-256-GCM. Formato: v1.<iv>.<authTag>.<ciphertext> (tudo base64). */
export function encryptSecret(plaintext: string): string {
  const key = loadKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    FORMAT_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.')
}

export function decryptSecret(encoded: string): string {
  const [version, ivB64, authTagB64, ciphertextB64] = encoded.split('.')
  if (version !== FORMAT_VERSION || !ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Formato de segredo criptografado inválido ou corrompido.')
  }

  const key = loadKey()
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  return plaintext.toString('utf8')
}

/**
 * Só para telas/logs de diagnóstico — nunca expõe o segredo real, só indício de
 * tamanho/formato suficiente para confirmar "está configurado" sem vazar o valor.
 */
export function maskSecret(plaintext: string | null | undefined): string {
  if (!plaintext) return '(vazio)'
  if (plaintext.length <= 8) return '••••••'
  return `${plaintext.slice(0, 4)}••••${plaintext.slice(-4)}`
}

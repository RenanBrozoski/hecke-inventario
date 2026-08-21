import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runEnvChecks } from './env-checks'

const ORIGINAL_ENV = { ...process.env }

function resetEnv() {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, ORIGINAL_ENV)
}

describe('runEnvChecks', () => {
  beforeEach(() => {
    resetEnv()
    delete process.env.DATABASE_URL
    delete process.env.DIRECT_URL
    delete process.env.BITRIX_CLIENT_ID
    delete process.env.BITRIX_CLIENT_SECRET
    delete process.env.BITRIX_TOKEN_ENCRYPTION_KEY
    delete process.env.SESSION_JWT_SECRET
    delete process.env.APP_BASE_URL
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  afterEach(() => {
    resetEnv()
  })

  it('nunca inclui o valor de um segredo nas mensagens', () => {
    process.env.SESSION_JWT_SECRET = 'segredo-super-secreto-que-nao-deveria-aparecer-em-lugar-nenhum'
    process.env.BITRIX_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    const checks = runEnvChecks()
    const allMessages = checks.map((c) => c.message).join(' ')
    expect(allMessages).not.toContain('segredo-super-secreto-que-nao-deveria-aparecer-em-lugar-nenhum')
    expect(allMessages).not.toContain(process.env.BITRIX_TOKEN_ENCRYPTION_KEY)
  })

  it('reporta erro quando DATABASE_URL não está definida', () => {
    const checks = runEnvChecks()
    const dbCheck = checks.find((c) => c.key === 'database_url')
    expect(dbCheck?.status).toBe('error')
  })

  it('reporta erro quando DATABASE_URL ainda é o placeholder do .env.example', () => {
    process.env.DATABASE_URL = 'postgresql://user:password@ep-xxxx-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require'
    const checks = runEnvChecks()
    const dbCheck = checks.find((c) => c.key === 'database_url')
    expect(dbCheck?.status).toBe('error')
    expect(dbCheck?.message).toMatch(/exemplo/)
  })

  it('reporta ok quando DATABASE_URL parece uma connection string real pooled', () => {
    process.env.DATABASE_URL = 'postgresql://real:realpass@ep-abc123-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require'
    const checks = runEnvChecks()
    expect(checks.find((c) => c.key === 'database_url')?.status).toBe('ok')
  })

  it('valida que BITRIX_TOKEN_ENCRYPTION_KEY decodifica para exatamente 32 bytes', () => {
    process.env.BITRIX_TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64')
    const checks = runEnvChecks()
    const keyCheck = checks.find((c) => c.key === 'bitrix_token_encryption_key')
    expect(keyCheck?.status).toBe('error')
    expect(keyCheck?.message).toMatch(/16 bytes/)
  })

  it('aprova BITRIX_TOKEN_ENCRYPTION_KEY com 32 bytes', () => {
    process.env.BITRIX_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64')
    const checks = runEnvChecks()
    expect(checks.find((c) => c.key === 'bitrix_token_encryption_key')?.status).toBe('ok')
  })

  it('avisa quando frame-ancestors está vazio', () => {
    const checks = runEnvChecks()
    expect(checks.find((c) => c.key === 'frame_ancestors')?.status).toBe('warning')
  })
})

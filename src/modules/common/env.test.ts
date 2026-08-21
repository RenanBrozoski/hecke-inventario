import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('getEnv', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
  })

  it('lança erro quando DATABASE_URL não está definida', async () => {
    delete process.env.DATABASE_URL
    const { getEnv } = await import('./env')
    expect(() => getEnv()).toThrow()
  })

  it('retorna valores válidos quando as variáveis obrigatórias estão presentes', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db'
    const { getEnv } = await import('./env')
    const env = getEnv()
    expect(env.DATABASE_URL).toContain('postgresql://')
    expect(env.NODE_ENV).toBe('test')
  })

  it('mantém o valor em cache entre chamadas dentro do mesmo módulo carregado', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db'
    const { getEnv } = await import('./env')
    const first = getEnv()
    process.env.DATABASE_URL = 'postgresql://outro:valor@localhost:5432/db'
    const second = getEnv()
    expect(second).toBe(first)
  })
})

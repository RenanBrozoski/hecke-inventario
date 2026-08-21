import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    bitrixHandshake: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('@/src/lib/prisma', () => ({ prisma: prismaMock }))

import { cleanupExpiredHandshakes, consumeHandshake, createHandshake, invalidateHandshakesForPortal } from './handshake'

describe('handshake (Bloco 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cria um handshake armazenando só o hash do código, nunca o código bruto', async () => {
    prismaMock.bitrixHandshake.create.mockResolvedValue({})

    const rawCode = await createHandshake({ portalId: 'portal-1', bitrixUserId: 'user-1' })

    expect(rawCode.length).toBeGreaterThan(20)
    expect(prismaMock.bitrixHandshake.create).toHaveBeenCalledTimes(1)

    const createArgs = prismaMock.bitrixHandshake.create.mock.calls[0]![0]
    expect(createArgs.data.codeHash).not.toBe(rawCode)
    expect(createArgs.data.codeHash).toMatch(/^[a-f0-9]{64}$/)
    expect(createArgs.data.portalId).toBe('portal-1')
    expect(createArgs.data.bitrixUserId).toBe('user-1')
    expect(createArgs.data.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('consome um handshake válido e retorna portal/usuário', async () => {
    prismaMock.bitrixHandshake.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.bitrixHandshake.findUnique.mockResolvedValue({
      portalId: 'portal-1',
      bitrixUserId: 'user-1',
    })

    const result = await consumeHandshake('codigo-qualquer')

    expect(result).toEqual({ portalId: 'portal-1', bitrixUserId: 'user-1' })
  })

  it('retorna null para código expirado ou já consumido (updateMany não afeta nenhuma linha)', async () => {
    prismaMock.bitrixHandshake.updateMany.mockResolvedValue({ count: 0 })

    const result = await consumeHandshake('codigo-expirado-ou-consumido')

    expect(result).toBeNull()
    expect(prismaMock.bitrixHandshake.findUnique).not.toHaveBeenCalled()
  })

  it('garante consumo único mesmo com duas tentativas concorrentes do mesmo código', async () => {
    let calls = 0
    prismaMock.bitrixHandshake.updateMany.mockImplementation(async () => {
      calls += 1
      // Simula o comportamento atômico do Postgres: só a primeira chamada
      // "ganha" a linha (count 1); qualquer outra concorrente vê count 0.
      return { count: calls === 1 ? 1 : 0 }
    })
    prismaMock.bitrixHandshake.findUnique.mockResolvedValue({
      portalId: 'portal-1',
      bitrixUserId: 'user-1',
    })

    const [first, second] = await Promise.all([
      consumeHandshake('mesmo-codigo'),
      consumeHandshake('mesmo-codigo'),
    ])

    const successCount = [first, second].filter(Boolean).length
    expect(successCount).toBe(1)
  })

  it('remove handshakes expirados/consumidos numa única página quando cabem num lote', async () => {
    prismaMock.bitrixHandshake.findMany.mockResolvedValueOnce([{ id: 'h1' }, { id: 'h2' }])
    prismaMock.bitrixHandshake.deleteMany.mockResolvedValue({ count: 2 })

    const deleted = await cleanupExpiredHandshakes()

    expect(deleted).toBe(2)
    // Página menor que o tamanho do lote => é a última, não busca uma segunda vez.
    expect(prismaMock.bitrixHandshake.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.bitrixHandshake.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['h1', 'h2'] } },
    })
  })

  it('processa em múltiplos lotes quando há mais registros do que o tamanho de um lote', async () => {
    const fullBatch = Array.from({ length: 500 }, (_, i) => ({ id: `full-${i}` }))
    prismaMock.bitrixHandshake.findMany
      .mockResolvedValueOnce(fullBatch) // primeira página: lote cheio (500) -> precisa buscar de novo
      .mockResolvedValueOnce([{ id: 'last' }]) // segunda página: o restante
    prismaMock.bitrixHandshake.deleteMany
      .mockResolvedValueOnce({ count: 500 })
      .mockResolvedValueOnce({ count: 1 })

    const deleted = await cleanupExpiredHandshakes()

    expect(deleted).toBe(501)
    expect(prismaMock.bitrixHandshake.findMany).toHaveBeenCalledTimes(2)
    expect(prismaMock.bitrixHandshake.deleteMany).toHaveBeenCalledTimes(2)
  })

  it('nunca remove handshakes ainda válidos (não expirados e não consumidos)', async () => {
    prismaMock.bitrixHandshake.findMany.mockResolvedValueOnce([])

    const deleted = await cleanupExpiredHandshakes()

    expect(deleted).toBe(0)
    expect(prismaMock.bitrixHandshake.deleteMany).not.toHaveBeenCalled()
  })

  it('invalida todos os handshakes de um portal (usado na reinstalação)', async () => {
    prismaMock.bitrixHandshake.deleteMany.mockResolvedValue({ count: 5 })

    const deleted = await invalidateHandshakesForPortal('portal-1')

    expect(deleted).toBe(5)
    expect(prismaMock.bitrixHandshake.deleteMany).toHaveBeenCalledWith({ where: { portalId: 'portal-1' } })
  })
})

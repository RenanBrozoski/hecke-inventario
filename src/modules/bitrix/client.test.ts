import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    bitrixPortal: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/src/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('./portal-credentials', () => ({
  decryptPortalTokens: vi.fn(() => ({
    accessToken: 'install-token-decriptado',
    refreshToken: 'refresh-decriptado',
  })),
  savePortalTokens: vi.fn(),
}))

import { callBitrixMethod, fetchCurrentUserWithContextToken } from './client'

describe('client — isolamento de credenciais (Bloco 6, item 6)', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('fetchCurrentUserWithContextToken usa só o token efêmero recebido — nunca lê/grava BitrixPortal', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ result: { ID: '42', ACTIVE: true } }),
    }) as unknown as typeof fetch

    const user = await fetchCurrentUserWithContextToken('empresa.bitrix24.com.br', 'token-efemero-do-abridor')

    expect(user.ID).toBe('42')
    expect(prismaMock.bitrixPortal.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(prismaMock.bitrixPortal.update).not.toHaveBeenCalled()

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    const requestInit = call[1] as RequestInit
    expect(JSON.parse(requestInit.body as string)).toEqual({ auth: 'token-efemero-do-abridor' })
  })

  it('callBitrixMethod usa a credencial persistida da instalação, nunca um token efêmero', async () => {
    prismaMock.bitrixPortal.findUniqueOrThrow.mockResolvedValue({
      id: 'portal-1',
      domain: 'empresa.bitrix24.com.br',
      status: 'ACTIVE',
      accessTokenEncrypted: 'x',
      refreshTokenEncrypted: 'y',
    })
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ result: { ok: true } }),
    }) as unknown as typeof fetch

    await callBitrixMethod('portal-1', 'department.get')

    expect(prismaMock.bitrixPortal.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'portal-1' } })
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    const requestInit = call[1] as RequestInit
    expect(JSON.parse(requestInit.body as string).auth).toBe('install-token-decriptado')
  })

  it('bloqueia chamadas quando o portal está com token inválido ou desinstalado', async () => {
    prismaMock.bitrixPortal.findUniqueOrThrow.mockResolvedValue({
      id: 'portal-1',
      domain: 'empresa.bitrix24.com.br',
      status: 'TOKEN_INVALID',
    })

    await expect(callBitrixMethod('portal-1', 'department.get')).rejects.toThrow(/não está apto/)
  })
})

import { randomBytes } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    bitrixPortal: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/src/lib/prisma', () => ({ prisma: prismaMock }))

import { activatePortal, upsertPortalOnInstall } from './portal-credentials'

describe('portal-credentials (Bloco 4)', () => {
  const ORIGINAL_KEY = process.env.BITRIX_TOKEN_ENCRYPTION_KEY

  beforeEach(() => {
    process.env.BITRIX_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env.BITRIX_TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY
  })

  it('faz upsert sempre pela chave memberId — reinstalar não duplica, só atualiza', async () => {
    prismaMock.bitrixPortal.upsert.mockResolvedValue({ id: 'portal-1' })

    const input = {
      domain: 'empresa.bitrix24.com.br',
      memberId: 'member-abc',
      accessToken: 'access-token-fake',
      refreshToken: 'refresh-token-fake',
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: ['user', 'department'],
      installedByBitrixUserId: '1',
      installedAt: new Date(),
    }

    await upsertPortalOnInstall(input)
    await upsertPortalOnInstall({ ...input, domain: 'novo-dominio.bitrix24.com.br' })

    expect(prismaMock.bitrixPortal.upsert).toHaveBeenCalledTimes(2)
    for (const call of prismaMock.bitrixPortal.upsert.mock.calls) {
      expect(call[0].where).toEqual({ memberId: 'member-abc' })
    }
    // A reinstalação reflete o novo domínio (permitido, ver Bloco 4, item 7) —
    // mas sempre na MESMA linha, nunca criando um portal duplicado.
    expect(prismaMock.bitrixPortal.upsert.mock.calls[1]![0].update.domain).toBe(
      'novo-dominio.bitrix24.com.br',
    )
  })

  it('nunca grava tokens em texto puro', async () => {
    prismaMock.bitrixPortal.upsert.mockResolvedValue({ id: 'portal-1' })

    await upsertPortalOnInstall({
      domain: 'empresa.bitrix24.com.br',
      memberId: 'member-abc',
      accessToken: 'segredo-em-texto-puro',
      refreshToken: 'outro-segredo-em-texto-puro',
      expiresAt: new Date(),
      scopes: [],
      installedByBitrixUserId: '1',
      installedAt: new Date(),
    })

    const args = prismaMock.bitrixPortal.upsert.mock.calls[0]![0]
    expect(args.create.accessTokenEncrypted).not.toContain('segredo-em-texto-puro')
    expect(args.create.refreshTokenEncrypted).not.toContain('outro-segredo-em-texto-puro')
  })

  it('reinstalação: preserva installedAt/installedByBitrixUserId e incrementa sessionVersion (item 5)', async () => {
    prismaMock.bitrixPortal.upsert.mockResolvedValue({ id: 'portal-1' })

    await upsertPortalOnInstall({
      domain: 'empresa.bitrix24.com.br',
      memberId: 'member-abc',
      accessToken: 'novo-access-token',
      refreshToken: 'novo-refresh-token',
      expiresAt: new Date(),
      scopes: ['user'],
      installedByBitrixUserId: '2', // outra pessoa reinstalou
      installedAt: new Date(), // data da reinstalação — não deve prevalecer
    })

    const updateArgs = prismaMock.bitrixPortal.upsert.mock.calls[0]![0].update
    // A reinstalação NUNCA sobrescreve quem instalou originalmente nem quando —
    // isso só é gravado na criação.
    expect(updateArgs.installedByBitrixUserId).toBeUndefined()
    expect(updateArgs.installedAt).toBeUndefined()
    // Mas incrementa sessionVersion, invalidando sessões emitidas antes.
    expect(updateArgs.sessionVersion).toEqual({ increment: 1 })
    // E sempre volta como PENDING até o chamador confirmar e ativar de novo —
    // é assim que um portal TOKEN_INVALID volta a ficar ACTIVE.
    expect(updateArgs.status).toBe('PENDING')
  })

  it('ativa o portal só explicitamente, via activatePortal', async () => {
    prismaMock.bitrixPortal.update.mockResolvedValue({ id: 'portal-1', status: 'ACTIVE' })

    const portal = await activatePortal('portal-1')

    expect(portal.status).toBe('ACTIVE')
    expect(prismaMock.bitrixPortal.update).toHaveBeenCalledWith({
      where: { id: 'portal-1' },
      data: { status: 'ACTIVE' },
    })
  })
})

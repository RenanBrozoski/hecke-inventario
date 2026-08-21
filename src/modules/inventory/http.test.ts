import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireSessionMock, isPortalAdministratorMock, roleFindMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  isPortalAdministratorMock: vi.fn(),
  roleFindMock: vi.fn(),
}))

vi.mock('@/src/modules/auth/require-session', () => ({ requireSession: requireSessionMock }))
vi.mock('@/src/modules/bitrix/admin', () => ({ isPortalAdministrator: isPortalAdministratorMock }))
vi.mock('@/src/lib/prisma', () => ({
  prisma: { inventoryRoleAssignment: { findUnique: roleFindMock } },
}))

import { requireInventoryContext } from './http'

const request = new Request('https://example.test/api/inventory/context', {
  headers: { authorization: 'Bearer token' },
})

describe('requireInventoryContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireSessionMock.mockResolvedValue({
      portal: { id: 'portal-da-sessao' },
      user: { bitrixUserId: 'user-7', fullName: 'Pessoa Sete' },
    })
  })

  it('dá override ADMIN ao administrador do portal sem consultar assignment', async () => {
    isPortalAdministratorMock.mockResolvedValue(true)
    await expect(requireInventoryContext(request)).resolves.toMatchObject({
      role: 'ADMIN',
      portalId: 'portal-da-sessao',
    })
    expect(roleFindMock).not.toHaveBeenCalled()
  })

  it('busca assignment pela chave composta do portal da sessão', async () => {
    isPortalAdministratorMock.mockResolvedValue(false)
    roleFindMock.mockResolvedValue({ role: 'OPERATOR' })
    await expect(requireInventoryContext(request)).resolves.toMatchObject({ role: 'OPERATOR' })
    expect(roleFindMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          portalId_bitrixUserId: { portalId: 'portal-da-sessao', bitrixUserId: 'user-7' },
        },
      }),
    )
  })

  it('nega acesso quando não existe atribuição explícita', async () => {
    isPortalAdministratorMock.mockResolvedValue(false)
    roleFindMock.mockResolvedValue(null)
    await expect(requireInventoryContext(request)).rejects.toMatchObject({
      name: 'InventoryForbiddenError',
    })
  })
})

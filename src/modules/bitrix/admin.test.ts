import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { bitrixPortal: { findUnique: vi.fn() } },
}))
vi.mock('@/src/lib/prisma', () => ({ prisma: prismaMock }))

import { isPortalAdministrator } from './admin'

describe('isPortalAdministrator (estabilização, item 3)', () => {
  const ORIGINAL_EXTRA = process.env.BITRIX_EXTRA_ADMIN_USER_IDS

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.BITRIX_EXTRA_ADMIN_USER_IDS
  })

  afterEach(() => {
    process.env.BITRIX_EXTRA_ADMIN_USER_IDS = ORIGINAL_EXTRA
  })

  it('reconhece o instalador do app como administrador', async () => {
    prismaMock.bitrixPortal.findUnique.mockResolvedValue({ installedByBitrixUserId: '1' })
    expect(await isPortalAdministrator('portal-1', '1')).toBe(true)
  })

  it('reconhece um usuário da lista extra (escopado ao portal correto)', async () => {
    prismaMock.bitrixPortal.findUnique.mockResolvedValue({ installedByBitrixUserId: '1' })
    process.env.BITRIX_EXTRA_ADMIN_USER_IDS = 'portal-1:3, portal-2:9'
    expect(await isPortalAdministrator('portal-1', '3')).toBe(true)
  })

  it('bloqueia um usuário comum que não instalou o app e não está na lista extra', async () => {
    prismaMock.bitrixPortal.findUnique.mockResolvedValue({ installedByBitrixUserId: '1' })
    expect(await isPortalAdministrator('portal-1', '2')).toBe(false)
  })

  it('NUNCA concede acesso quando o ID extra pertence a outro portal (item explícito da estabilização)', async () => {
    prismaMock.bitrixPortal.findUnique.mockResolvedValue({ installedByBitrixUserId: '1' })
    // "9" é admin extra do portal-2, não do portal-1 — o mesmo bitrixUserId
    // não pode "vazar" para outro portal.
    process.env.BITRIX_EXTRA_ADMIN_USER_IDS = 'portal-2:9'
    expect(await isPortalAdministrator('portal-1', '9')).toBe(false)
  })

  it('ignora entradas malformadas (sem "portalId:") em vez de tratá-las como acesso global', async () => {
    prismaMock.bitrixPortal.findUnique.mockResolvedValue({ installedByBitrixUserId: '1' })
    // Sem o prefixo do portal, "42" sozinho nunca deve conceder admin a ninguém.
    process.env.BITRIX_EXTRA_ADMIN_USER_IDS = '42'
    expect(await isPortalAdministrator('portal-1', '42')).toBe(false)
  })

  it('retorna false quando o portal não existe', async () => {
    prismaMock.bitrixPortal.findUnique.mockResolvedValue(null)
    expect(await isPortalAdministrator('portal-inexistente', '1')).toBe(false)
  })
})

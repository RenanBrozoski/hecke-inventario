import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireSessionMock, searchBitrixUsersMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  searchBitrixUsersMock: vi.fn(),
}))

vi.mock('@/src/modules/auth/require-session', () => ({ requireSession: requireSessionMock }))
vi.mock('@/src/modules/bitrix/directory-search', () => ({ searchBitrixUsers: searchBitrixUsersMock }))

import { GET } from './route'

describe('GET /api/bitrix/users — busca paginada', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireSessionMock.mockResolvedValue({ portal: { id: 'portal-1' }, user: { bitrixUserId: 'user-1' } })
  })

  it('repassa search/página/tamanho de página e escopa pelo portal da sessão', async () => {
    searchBitrixUsersMock.mockResolvedValue({ items: [{ bitrixUserId: '1', fullName: 'Ana' }], total: 1, page: 2, pageSize: 10 })

    const req = new Request('https://example.test/api/bitrix/users?search=ana&page=2&pageSize=10', {
      headers: { authorization: 'Bearer x' },
    })
    const response = await GET(req)
    const body = (await response.json()) as { items: unknown[]; page: number }

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.page).toBe(2)
    expect(searchBitrixUsersMock).toHaveBeenCalledWith({
      portalId: 'portal-1',
      search: 'ana',
      activeOnly: true,
      page: 2,
      pageSize: 10,
    })
  })

  it('rejeita sem sessão válida (401)', async () => {
    const { SessionValidationError } = await import('@/src/modules/auth/session')
    requireSessionMock.mockRejectedValue(new SessionValidationError('sem sessão', 'MISSING'))

    const req = new Request('https://example.test/api/bitrix/users')
    const response = await GET(req)

    expect(response.status).toBe(401)
  })
})

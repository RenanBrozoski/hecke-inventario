import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireSessionMock, searchBitrixDepartmentsMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  searchBitrixDepartmentsMock: vi.fn(),
}))

vi.mock('@/src/modules/auth/require-session', () => ({ requireSession: requireSessionMock }))
vi.mock('@/src/modules/bitrix/directory-search', () => ({ searchBitrixDepartments: searchBitrixDepartmentsMock }))

import { GET } from './route'

describe('GET /api/bitrix/departments — busca paginada', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireSessionMock.mockResolvedValue({ portal: { id: 'portal-1' }, user: { bitrixUserId: 'user-1' } })
  })

  it('repassa parâmetros de busca/paginação e escopa pelo portal da sessão', async () => {
    searchBitrixDepartmentsMock.mockResolvedValue({
      items: [{ bitrixDepartmentId: '10', name: 'TI' }],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    const req = new Request('https://example.test/api/bitrix/departments?search=ti', {
      headers: { authorization: 'Bearer x' },
    })
    const response = await GET(req)
    const body = (await response.json()) as { items: unknown[] }

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(searchBitrixDepartmentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ portalId: 'portal-1', search: 'ti' }),
    )
  })
})

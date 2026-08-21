import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireSessionMock, isPortalAdministratorMock, sendMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  isPortalAdministratorMock: vi.fn(),
  sendMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/src/modules/auth/require-session', () => ({ requireSession: requireSessionMock }))
vi.mock('@/src/modules/bitrix/admin', () => ({ isPortalAdministrator: isPortalAdministratorMock }))
vi.mock('@/src/lib/inngest/client', () => ({ inngest: { send: sendMock } }))

import { POST } from './route'

function request(): Request {
  return new Request('https://example.test/api/bitrix/sync/trigger', {
    method: 'POST',
    headers: { authorization: 'Bearer qualquer-coisa' },
  })
}

describe('POST /api/bitrix/sync/trigger (Bloco 7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('bloqueia com 403 quando o usuário não é administrador', async () => {
    requireSessionMock.mockResolvedValue({
      portal: { id: 'portal-1' },
      user: { bitrixUserId: 'user-comum' },
    })
    isPortalAdministratorMock.mockResolvedValue(false)

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('dispara a sincronização quando o usuário é administrador', async () => {
    requireSessionMock.mockResolvedValue({
      portal: { id: 'portal-1' },
      user: { bitrixUserId: 'user-admin' },
    })
    isPortalAdministratorMock.mockResolvedValue(true)

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(sendMock).toHaveBeenCalledWith({
      name: 'bitrix/portal.sync.requested',
      data: { portalId: 'portal-1' },
    })
  })
})

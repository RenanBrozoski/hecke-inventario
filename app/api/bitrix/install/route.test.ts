import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  fetchCurrentUserMock,
  upsertPortalOnInstallMock,
  activatePortalMock,
  invalidateHandshakesForPortalMock,
  sendMock,
} = vi.hoisted(() => ({
  fetchCurrentUserMock: vi.fn(),
  upsertPortalOnInstallMock: vi.fn(),
  activatePortalMock: vi.fn(),
  invalidateHandshakesForPortalMock: vi.fn().mockResolvedValue(0),
  sendMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/src/modules/bitrix/client', () => ({
  fetchCurrentUserWithContextToken: fetchCurrentUserMock,
}))

vi.mock('@/src/modules/bitrix/portal-credentials', () => ({
  upsertPortalOnInstall: upsertPortalOnInstallMock,
  activatePortal: activatePortalMock,
}))

vi.mock('@/src/modules/auth/handshake', () => ({
  invalidateHandshakesForPortal: invalidateHandshakesForPortalMock,
}))

vi.mock('@/src/lib/inngest/client', () => ({ inngest: { send: sendMock } }))

import { POST } from './route'

function formRequest(fields: Record<string, string>): Request {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  return new Request('https://example.test/api/bitrix/install', { method: 'POST', body: form })
}

const VALID_FIELDS = {
  DOMAIN: 'empresa.bitrix24.com.br',
  member_id: 'member-abc',
  AUTH_ID: 'auth-id-fake',
  REFRESH_ID: 'refresh-id-fake',
  AUTH_EXPIRES: '3600',
}

describe('POST /api/bitrix/install (Bloco 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejeita (400) quando faltam campos obrigatórios', async () => {
    const response = await POST(formRequest({ DOMAIN: 'empresa.bitrix24.com.br' }))

    expect(response.status).toBe(400)
    expect(fetchCurrentUserMock).not.toHaveBeenCalled()
    expect(upsertPortalOnInstallMock).not.toHaveBeenCalled()
  })

  it('não persiste nem ativa quando o AUTH_ID é inválido (user.current falha)', async () => {
    fetchCurrentUserMock.mockRejectedValue(new Error('token inválido'))

    const response = await POST(formRequest(VALID_FIELDS))
    const html = await response.text()

    expect(upsertPortalOnInstallMock).not.toHaveBeenCalled()
    expect(activatePortalMock).not.toHaveBeenCalled()
    expect(html).not.toContain('installFinish')
  })

  it('rejeita quando o usuário instalador está inativo no Bitrix24', async () => {
    fetchCurrentUserMock.mockResolvedValue({ ID: '1', ACTIVE: false })

    await POST(formRequest(VALID_FIELDS))

    expect(upsertPortalOnInstallMock).not.toHaveBeenCalled()
  })

  it('ativa o portal e agenda o sync inicial quando a validação é bem-sucedida', async () => {
    fetchCurrentUserMock.mockResolvedValue({ ID: '1', ACTIVE: true })
    upsertPortalOnInstallMock.mockResolvedValue({ id: 'portal-1' })
    activatePortalMock.mockResolvedValue({ id: 'portal-1', status: 'ACTIVE' })

    const response = await POST(formRequest(VALID_FIELDS))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('installFinish')
    expect(activatePortalMock).toHaveBeenCalledWith('portal-1')
    // Higiene de segurança: toda (re)instalação invalida handshakes antigos.
    expect(invalidateHandshakesForPortalMock).toHaveBeenCalledWith('portal-1')
    expect(sendMock).toHaveBeenCalledWith({
      name: 'bitrix/portal.sync.requested',
      data: { portalId: 'portal-1' },
    })
  })
})

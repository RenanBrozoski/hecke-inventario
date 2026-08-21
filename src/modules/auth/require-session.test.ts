import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    bitrixPortal: { findUnique: vi.fn() },
    bitrixUser: { findUnique: vi.fn() },
  },
}))

vi.mock('@/src/lib/prisma', () => ({ prisma: prismaMock }))

import { issueSessionToken } from './session'
import { requireSession } from './require-session'

function requestWithToken(token: string | null): Request {
  const headers = new Headers()
  if (token) headers.set('authorization', `Bearer ${token}`)
  return new Request('https://example.test/api/auth/me', { headers })
}

describe('requireSession (Bloco 6)', () => {
  const ORIGINAL_SECRET = process.env.SESSION_JWT_SECRET

  beforeEach(() => {
    process.env.SESSION_JWT_SECRET = 'segredo-de-teste-com-mais-de-16-caracteres'
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env.SESSION_JWT_SECRET = ORIGINAL_SECRET
  })

  it('rejeita quando o cabeçalho Authorization está ausente', async () => {
    await expect(requireSession(requestWithToken(null))).rejects.toMatchObject({ code: 'MISSING' })
  })

  it('rejeita quando o portal não está ACTIVE', async () => {
    const session = await issueSessionToken({ portalId: 'portal-1', bitrixUserId: 'user-1', sessionVersion: 1 })
    prismaMock.bitrixPortal.findUnique.mockResolvedValue({
      id: 'portal-1',
      status: 'TOKEN_INVALID',
      sessionVersion: 1,
    })

    await expect(requireSession(requestWithToken(session.token))).rejects.toMatchObject({
      code: 'PORTAL_INACTIVE',
    })
  })

  it('rejeita quando o usuário local não existe ou está inativo', async () => {
    const session = await issueSessionToken({ portalId: 'portal-1', bitrixUserId: 'user-1', sessionVersion: 1 })
    prismaMock.bitrixPortal.findUnique.mockResolvedValue({ id: 'portal-1', status: 'ACTIVE', sessionVersion: 1 })
    prismaMock.bitrixUser.findUnique.mockResolvedValue({ bitrixUserId: 'user-1', active: false })

    await expect(requireSession(requestWithToken(session.token))).rejects.toMatchObject({
      code: 'USER_INACTIVE',
    })
  })

  it('rejeita uma sessão emitida com sessionVersion antiga (revogada por reinstalação, item 5)', async () => {
    // Sessão emitida quando sessionVersion ainda era 1...
    const session = await issueSessionToken({ portalId: 'portal-1', bitrixUserId: 'user-1', sessionVersion: 1 })
    // ...mas o portal já foi reinstalado e está em sessionVersion 2.
    prismaMock.bitrixPortal.findUnique.mockResolvedValue({ id: 'portal-1', status: 'ACTIVE', sessionVersion: 2 })

    await expect(requireSession(requestWithToken(session.token))).rejects.toMatchObject({
      code: 'STALE_SESSION',
    })
    expect(prismaMock.bitrixUser.findUnique).not.toHaveBeenCalled()
  })

  it('aceita quando portal ACTIVE, sessionVersion confere e usuário ativo', async () => {
    const session = await issueSessionToken({ portalId: 'portal-1', bitrixUserId: 'user-1', sessionVersion: 1 })
    prismaMock.bitrixPortal.findUnique.mockResolvedValue({ id: 'portal-1', status: 'ACTIVE', sessionVersion: 1 })
    prismaMock.bitrixUser.findUnique.mockResolvedValue({ bitrixUserId: 'user-1', active: true })

    const context = await requireSession(requestWithToken(session.token))
    expect(context.portal.id).toBe('portal-1')
    expect(context.user.bitrixUserId).toBe('user-1')
  })
})

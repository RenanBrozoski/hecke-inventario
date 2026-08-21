import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Fake mínimo do Prisma em memória — permite reproduzir de ponta a ponta
// (handler -> bootstrap do usuário -> handshake -> exchange -> requireSession)
// sem depender de um Postgres real.
const { fetchCurrentUserMock, state } = vi.hoisted(() => ({
  fetchCurrentUserMock: vi.fn(),
  state: {
    portals: new Map<string, Record<string, unknown>>(),
    users: new Map<string, Record<string, unknown>>(),
    handshakes: new Map<string, { codeHash: string; portalId: string; bitrixUserId: string; expiresAt: Date; consumedAt: Date | null }>(),
  },
}))

vi.mock('@/src/modules/bitrix/client', () => ({
  fetchCurrentUserWithContextToken: fetchCurrentUserMock,
}))

vi.mock('@/src/lib/prisma', () => ({
  prisma: {
    bitrixPortal: {
      findUnique: vi.fn(async ({ where }: { where: { memberId?: string; id?: string } }) => {
        if (where.memberId) {
          for (const portal of state.portals.values()) {
            if (portal.memberId === where.memberId) return portal
          }
          return null
        }
        return state.portals.get(where.id as string) ?? null
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const updated = { ...state.portals.get(where.id), ...data }
        state.portals.set(where.id, updated)
        return updated
      }),
    },
    bitrixUser: {
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { portalId_bitrixUserId: { portalId: string; bitrixUserId: string } }
          create: Record<string, unknown>
          update: Record<string, unknown>
        }) => {
          const key = `${where.portalId_bitrixUserId.portalId}:${where.portalId_bitrixUserId.bitrixUserId}`
          const existing = state.users.get(key)
          const record = existing ? { ...existing, ...update } : { ...create }
          state.users.set(key, record)
          return record
        },
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { portalId_bitrixUserId: { portalId: string; bitrixUserId: string } } }) => {
          const key = `${where.portalId_bitrixUserId.portalId}:${where.portalId_bitrixUserId.bitrixUserId}`
          return state.users.get(key) ?? null
        },
      ),
    },
    bitrixHandshake: {
      create: vi.fn(async ({ data }: { data: { codeHash: string; portalId: string; bitrixUserId: string; expiresAt: Date } }) => {
        state.handshakes.set(data.codeHash, { ...data, consumedAt: null })
        return data
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { codeHash: string }; data: { consumedAt: Date } }) => {
        const handshake = state.handshakes.get(where.codeHash)
        if (!handshake || handshake.consumedAt !== null || handshake.expiresAt.getTime() < Date.now()) {
          return { count: 0 }
        }
        handshake.consumedAt = data.consumedAt
        return { count: 1 }
      }),
      findUnique: vi.fn(async ({ where }: { where: { codeHash: string } }) => state.handshakes.get(where.codeHash) ?? null),
    },
  },
}))

import { POST as handlerPOST } from './route'
import { POST as exchangePOST } from '../../auth/exchange/route'
import { requireSession } from '@/src/modules/auth/require-session'

function formRequest(fields: Record<string, string>): Request {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  return new Request('https://example.test/api/bitrix/handler', { method: 'POST', body: form })
}

describe('estabilização — primeira abertura antes do sync completo (item 1)', () => {
  const ORIGINAL_SECRET = process.env.SESSION_JWT_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    state.portals.clear()
    state.users.clear()
    state.handshakes.clear()
    process.env.SESSION_JWT_SECRET = 'segredo-de-teste-com-mais-de-16-caracteres'

    state.portals.set('portal-1', {
      id: 'portal-1',
      memberId: 'member-abc',
      domain: 'empresa.bitrix24.com.br',
      status: 'ACTIVE',
      sessionVersion: 1,
    })
  })

  afterEach(() => {
    process.env.SESSION_JWT_SECRET = ORIGINAL_SECRET
  })

  it('cria o BitrixUser na hora (sem esperar o sync completo) e a sessão resultante passa em requireSession', async () => {
    // Usuário "7" ainda NÃO existe em state.users — reproduz exatamente a corrida descrita.
    expect(state.users.has('portal-1:7')).toBe(false)
    fetchCurrentUserMock.mockResolvedValue({ ID: '7', NAME: 'Ana', ACTIVE: true })

    // 1. Handler valida user.current e deveria criar o usuário localmente.
    const handlerResponse = await handlerPOST(
      formRequest({ DOMAIN: 'empresa.bitrix24.com.br', member_id: 'member-abc', AUTH_ID: 'auth-efemero' }),
    )

    expect(handlerResponse.status).toBe(303)
    const bootstrapped = state.users.get('portal-1:7')
    expect(bootstrapped).toBeDefined()
    expect(bootstrapped?.active).toBe(true)

    const location = handlerResponse.headers.get('location')
    expect(location).toBeTruthy()
    const handshakeCode = new URL(location!).searchParams.get('hs')
    expect(handshakeCode).toBeTruthy()

    // 2. Exchange: troca o handshake por uma sessão.
    const exchangeResponse = await exchangePOST(
      new Request('https://example.test/api/auth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: handshakeCode }),
      }),
    )
    expect(exchangeResponse.status).toBe(200)
    const { token } = (await exchangeResponse.json()) as { token: string }

    // 3. requireSession aceita a sessão — o usuário já existe (bootstrap do passo 1),
    // mesmo que o sync completo do Inngest ainda não tenha rodado.
    const meRequest = new Request('https://example.test/api/auth/me', {
      headers: { authorization: `Bearer ${token}` },
    })
    const context = await requireSession(meRequest)
    expect(context.user.bitrixUserId).toBe('7')
    expect(context.portal.id).toBe('portal-1')
  })
})

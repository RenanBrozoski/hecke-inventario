import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Fake mínimo do Prisma em memória — mesmo padrão usado nos outros testes de
// abertura/instalação do Bitrix24 (ver app/api/bitrix/handler/route.test.ts).
const { sendMock, state } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue(undefined),
  state: {
    portals: new Map<string, Record<string, unknown>>(),
    users: new Map<string, Record<string, unknown>>(),
    handshakes: new Map<string, { codeHash: string; portalId: string; bitrixUserId: string; expiresAt: Date; consumedAt: Date | null }>(),
  },
}))

vi.mock('@/src/lib/inngest/client', () => ({ inngest: { send: sendMock } }))

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
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { memberId: string }
          create: Record<string, unknown>
          update: Record<string, unknown>
        }) => {
          for (const [id, portal] of state.portals.entries()) {
            if (portal.memberId === where.memberId) {
              const updated = { ...portal, ...update }
              state.portals.set(id, updated)
              return updated
            }
          }
          const id = `portal-${where.memberId}`
          const created = { id, ...create }
          state.portals.set(id, created)
          return created
        },
      ),
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
      deleteMany: vi.fn(async ({ where }: { where: { portalId: string } }) => {
        let count = 0
        for (const [code, handshake] of state.handshakes.entries()) {
          if (handshake.portalId === where.portalId) {
            state.handshakes.delete(code)
            count += 1
          }
        }
        return { count }
      }),
    },
  },
}))

import { POST as bootstrapPOST } from './route'

function jsonRequest(body: unknown): Request {
  return new Request('https://bitrix-forms-432f.vercel.app/api/bitrix/session-bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID_AUTH = {
  domain: 'hecke.bitrix24.com.br',
  member_id: 'member-abc',
  access_token: 'access-token-do-sdk',
  refresh_token: 'refresh-token-do-sdk',
  expires_in: 3600,
  scope: 'user,department',
}

describe('POST /api/bitrix/session-bootstrap', () => {
  const ORIGINAL_ENCRYPTION_KEY = process.env.BITRIX_TOKEN_ENCRYPTION_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    state.portals.clear()
    state.users.clear()
    state.handshakes.clear()
    // upsertPortalOnInstall (primeira abertura) criptografa os tokens de
    // verdade — precisa de uma chave AES-256 válida (32 bytes em base64).
    process.env.BITRIX_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  })

  afterEach(() => {
    process.env.BITRIX_TOKEN_ENCRYPTION_KEY = ORIGINAL_ENCRYPTION_KEY
  })

  it('cria e ativa o portal na primeira abertura (member_id desconhecido) e devolve um handshake', async () => {
    const response = await bootstrapPOST(
      jsonRequest({
        auth: VALID_AUTH,
        user: { ID: '9', NAME: 'Bruno', ACTIVE: true },
        placement: 'DEFAULT',
      }),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { code: string }
    expect(body.code).toBeTruthy()

    const created = state.portals.get('portal-member-abc')
    expect(created).toMatchObject({ memberId: 'member-abc', domain: 'hecke.bitrix24.com.br', status: 'ACTIVE' })
    expect(sendMock).toHaveBeenCalledWith({
      name: 'bitrix/portal.sync.requested',
      data: { portalId: 'portal-member-abc' },
    })
    expect(state.users.get('portal-member-abc:9')).toBeDefined()
  })

  it('reutiliza o portal já existente e ativo em aberturas seguintes, sem recriar', async () => {
    state.portals.set('portal-1', {
      id: 'portal-1',
      memberId: 'member-abc',
      domain: 'hecke.bitrix24.com.br',
      status: 'ACTIVE',
      sessionVersion: 1,
    })

    const response = await bootstrapPOST(
      jsonRequest({ auth: VALID_AUTH, user: { ID: '9', NAME: 'Bruno', ACTIVE: true } }),
    )

    expect(response.status).toBe(200)
    expect(state.portals.has('portal-member-abc')).toBe(false)
    expect(state.users.get('portal-1:9')).toBeDefined()
  })

  it('rejeita quando o usuário está inativo no Bitrix24', async () => {
    const response = await bootstrapPOST(
      jsonRequest({ auth: VALID_AUTH, user: { ID: '9', NAME: 'Bruno', ACTIVE: false } }),
    )

    expect(response.status).toBe(401)
    expect(state.portals.has('portal-member-abc')).toBe(false)
  })

  it('rejeita quando o portal existente não está ACTIVE', async () => {
    state.portals.set('portal-1', {
      id: 'portal-1',
      memberId: 'member-abc',
      domain: 'hecke.bitrix24.com.br',
      status: 'TOKEN_INVALID',
      sessionVersion: 1,
    })

    const response = await bootstrapPOST(
      jsonRequest({ auth: VALID_AUTH, user: { ID: '9', NAME: 'Bruno', ACTIVE: true } }),
    )

    expect(response.status).toBe(401)
  })

  it('retorna 400 quando o corpo não bate com o formato esperado (auth/user ausentes)', async () => {
    const response = await bootstrapPOST(jsonRequest({ auth: { domain: 'x' } }))
    expect(response.status).toBe(400)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const { contextMock, listMock, createMock } = vi.hoisted(() => ({
  contextMock: vi.fn(),
  listMock: vi.fn(),
  createMock: vi.fn(),
}))

vi.mock('@/src/modules/inventory/http', () => ({
  requireInventoryContext: contextMock,
  requireInventoryRole: (context: { role: string }, minimum: string) => {
    const level: Record<string, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 }
    if ((level[context.role] ?? -1) < (level[minimum] ?? Number.POSITIVE_INFINITY)) {
      throw new Error('FORBIDDEN')
    }
  },
  parseJsonBody: (request: Request) => request.json(),
  jsonOk: (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }),
  inventoryErrorResponse: (error: unknown) => {
    if (error instanceof z.ZodError)
      return Response.json({ error: 'Payload inválido.' }, { status: 400 })
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return Response.json({ error: 'Sem permissão.' }, { status: 403 })
    }
    return Response.json({ error: 'Erro interno.' }, { status: 500 })
  },
}))

vi.mock('@/src/modules/inventory/service', () => ({
  listEquipment: listMock,
  createEquipment: createMock,
}))

import { GET, POST } from './route'

function request(method: string, body?: unknown, query = '') {
  return new Request(`https://example.test/api/inventory/equipment${query}`, {
    method,
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('GET/POST /api/inventory/equipment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contextMock.mockResolvedValue({
      portalId: 'portal-da-sessao',
      bitrixUserId: 'user-da-sessao',
      userName: 'Usuário',
      role: 'OPERATOR',
    })
  })

  it('lista exclusivamente com o portal vindo da sessão', async () => {
    listMock.mockResolvedValue({ items: [], total: 0, page: 2, pageSize: 10, totalPages: 0 })
    const response = await GET(request('GET', undefined, '?page=2&pageSize=10'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(listMock).toHaveBeenCalledWith(
      'portal-da-sessao',
      expect.objectContaining({ page: 2, pageSize: 10 }),
    )
  })

  it('rejeita portalId/ator no body em vez de repassá-los ao serviço', async () => {
    const response = await POST(
      request('POST', {
        categoryId: 'cat-1',
        portalId: 'portal-invadido',
        bitrixUserId: 'ator-forjado',
      }),
    )
    expect(response.status).toBe(400)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('bloqueia escrita de VIEWER antes de ler o body', async () => {
    contextMock.mockResolvedValue({
      portalId: 'portal-da-sessao',
      bitrixUserId: 'viewer',
      userName: 'Leitor',
      role: 'VIEWER',
    })
    const response = await POST(request('POST', { categoryId: 'cat-1' }))
    expect(response.status).toBe(403)
    expect(createMock).not.toHaveBeenCalled()
  })
})

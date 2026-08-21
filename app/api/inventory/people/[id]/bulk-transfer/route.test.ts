import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const { contextMock, serviceMock } = vi.hoisted(() => ({
  contextMock: vi.fn(),
  serviceMock: vi.fn(),
}))

vi.mock('@/src/modules/inventory/http', () => ({
  requireInventoryContext: contextMock,
  requireInventoryRole: (context: { role: string }) => {
    if (context.role === 'VIEWER') throw new Error('FORBIDDEN')
  },
  parseJsonBody: (request: Request) => request.json(),
  jsonOk: (body: unknown, status = 200) => Response.json(body, { status }),
  inventoryErrorResponse: (error: unknown) => {
    if (error instanceof z.ZodError)
      return Response.json({ error: 'Payload inválido.' }, { status: 400 })
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return Response.json({ error: 'Sem permissão.' }, { status: 403 })
    }
    return Response.json({ error: 'Erro interno.' }, { status: 500 })
  },
}))

vi.mock('@/src/modules/inventory/service', () => ({ bulkTransferEquipment: serviceMock }))

import { POST } from './route'

function request(body: unknown) {
  return new Request('https://example.test/api/inventory/people/source/bulk-transfer', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  equipmentIds: ['eq-1'],
  expectedRevisions: { 'eq-1': 4 },
  destinationPersonId: null,
  movedAt: '2026-08-20',
  reason: null,
  createTerm: true,
}

describe('POST /api/inventory/people/[id]/bulk-transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contextMock.mockResolvedValue({
      portalId: 'portal-da-sessao',
      bitrixUserId: 'user-da-sessao',
      userName: 'Operador',
      role: 'OPERATOR',
    })
  })

  it('repassa apenas contexto autenticado, origem da URL e payload validado', async () => {
    serviceMock.mockResolvedValue({ transferredCount: 1, movements: [], term: null })
    const response = await POST(request(validBody), {
      params: Promise.resolve({ id: 'person-source' }),
    })

    expect(response.status).toBe(200)
    expect(serviceMock).toHaveBeenCalledWith(
      expect.objectContaining({ portalId: 'portal-da-sessao', bitrixUserId: 'user-da-sessao' }),
      'person-source',
      validBody,
    )
  })

  it('rejeita portalId/ator forjados e bloqueia VIEWER', async () => {
    const invalidResponse = await POST(request({ ...validBody, portalId: 'portal-invadido' }), {
      params: Promise.resolve({ id: 'person-source' }),
    })
    expect(invalidResponse.status).toBe(400)
    expect(serviceMock).not.toHaveBeenCalled()

    contextMock.mockResolvedValue({ portalId: 'portal-da-sessao', role: 'VIEWER' })
    const forbiddenResponse = await POST(request(validBody), {
      params: Promise.resolve({ id: 'person-source' }),
    })
    expect(forbiddenResponse.status).toBe(403)
    expect(serviceMock).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const { contextMock, listMock, uploadMock } = vi.hoisted(() => ({
  contextMock: vi.fn(),
  listMock: vi.fn(),
  uploadMock: vi.fn(),
}))

vi.mock('@/src/modules/inventory/http', () => ({
  InventoryValidationError: class InventoryValidationError extends Error {},
  requireInventoryContext: contextMock,
  requireInventoryRole: (context: { role: string }, minimum: string) => {
    const level: Record<string, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 }
    if ((level[context.role] ?? -1) < (level[minimum] ?? Number.POSITIVE_INFINITY)) {
      throw new Error('FORBIDDEN')
    }
  },
  jsonOk: (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }),
  inventoryErrorResponse: (error: unknown) => {
    if (error instanceof z.ZodError) return Response.json({ error: 'Inválido.' }, { status: 400 })
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return Response.json({ error: 'Sem permissão.' }, { status: 403 })
    }
    if (error instanceof Error && error.name === 'InventoryValidationError') {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json({ error: 'Erro interno.' }, { status: 500 })
  },
}))

vi.mock('@/src/modules/inventory/attachment-service', () => ({
  MAX_INVENTORY_ATTACHMENT_REQUEST_BYTES: 4 * 1024 * 1024 + 256 * 1024,
  listInventoryAttachments: listMock,
  uploadInventoryAttachment: uploadMock,
}))

import { GET, POST } from './route'

const operator = {
  portalId: 'portal-da-sessao',
  bitrixUserId: 'user-da-sessao',
  userName: 'Usuário',
  role: 'OPERATOR',
}

describe('GET/POST /api/inventory/attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contextMock.mockResolvedValue(operator)
  })

  it('lista usando exclusivamente o portal resolvido pela sessão', async () => {
    listMock.mockResolvedValue([])
    const request = new Request(
      'https://example.test/api/inventory/attachments?entityType=EQUIPMENT&entityId=eq-1',
      { headers: { authorization: 'Bearer token' } },
    )
    const response = await GET(request)
    expect(response.status).toBe(200)
    expect(listMock).toHaveBeenCalledWith('portal-da-sessao', 'EQUIPMENT', 'eq-1')
  })

  it('envia arquivo e ator ao serviço sem aceitar portalId do formulário', async () => {
    const form = new FormData()
    form.set('entityType', 'EQUIPMENT')
    form.set('entityId', 'eq-1')
    form.set('portalId', 'portal-invadido')
    form.set('description', 'Nota fiscal')
    form.set('file', new File([Buffer.from('%PDF-1.7\n')], 'nota.pdf', { type: 'application/pdf' }))
    uploadMock.mockResolvedValue({ id: 'attachment-1' })

    const response = await POST(
      new Request('https://example.test/api/inventory/attachments', {
        method: 'POST',
        headers: { authorization: 'Bearer token' },
        body: form,
      }),
    )

    expect(response.status).toBe(201)
    expect(uploadMock).toHaveBeenCalledWith(
      operator,
      expect.objectContaining({
        entityType: 'EQUIPMENT',
        entityId: 'eq-1',
        description: 'Nota fiscal',
        file: expect.objectContaining({ name: 'nota.pdf', type: 'application/pdf' }),
      }),
    )
    expect(uploadMock.mock.calls[0]?.[1]).not.toHaveProperty('portalId')
  })

  it('bloqueia VIEWER antes de processar o multipart', async () => {
    contextMock.mockResolvedValue({ ...operator, role: 'VIEWER' })
    const response = await POST(
      new Request('https://example.test/api/inventory/attachments', {
        method: 'POST',
        headers: { authorization: 'Bearer token', 'content-type': 'not/multipart' },
        body: 'não deve ser lido',
      }),
    )
    expect(response.status).toBe(403)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('rejeita um tipo de alvo desconhecido', async () => {
    const request = new Request(
      'https://example.test/api/inventory/attachments?entityType=OTHER&entityId=eq-1',
      { headers: { authorization: 'Bearer token' } },
    )
    const response = await GET(request)
    expect(response.status).toBe(400)
    expect(listMock).not.toHaveBeenCalled()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { contextMock, downloadMock, deleteMock } = vi.hoisted(() => ({
  contextMock: vi.fn(),
  downloadMock: vi.fn(),
  deleteMock: vi.fn(),
}))

vi.mock('@/src/modules/inventory/http', () => ({
  requireInventoryContext: contextMock,
  requireInventoryRole: (context: { role: string }, minimum: string) => {
    const level: Record<string, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 }
    if ((level[context.role] ?? -1) < (level[minimum] ?? Number.POSITIVE_INFINITY)) {
      throw new Error('FORBIDDEN')
    }
  },
  jsonOk: (body: unknown, status = 200) => Response.json(body, { status }),
  inventoryErrorResponse: (error: unknown) =>
    Response.json(
      { error: 'Falha.' },
      { status: error instanceof Error && error.message === 'FORBIDDEN' ? 403 : 500 },
    ),
}))

vi.mock('@/src/modules/inventory/attachment-service', () => ({
  getInventoryAttachmentForDownload: downloadMock,
  deleteInventoryAttachment: deleteMock,
  isTrustedVercelBlobUrl: (url: string) => url.includes('.blob.vercel-storage.com'),
  contentDispositionAttachment: (name: string) => `attachment; filename="${name}"`,
}))

import { DELETE, GET } from './route'

const operator = {
  portalId: 'portal-da-sessao',
  bitrixUserId: 'user-da-sessao',
  userName: 'Usuário',
  role: 'OPERATOR',
}
const originalFetch = globalThis.fetch

describe('GET/DELETE /api/inventory/attachments/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contextMock.mockResolvedValue(operator)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('autoriza no portal antes de servir o blob sem expor sua URL na resposta', async () => {
    downloadMock.mockResolvedValue({
      id: 'attachment-1',
      blobUrl: 'https://store.public.blob.vercel-storage.com/random.pdf',
      originalName: 'nota.pdf',
      contentType: 'application/pdf',
      size: 8,
    })
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('12345678', { status: 200 }))

    const response = await GET(
      new Request('https://example.test/api/inventory/attachments/attachment-1', {
        headers: { authorization: 'Bearer token' },
      }),
      { params: Promise.resolve({ id: 'attachment-1' }) },
    )

    expect(response.status).toBe(200)
    expect(downloadMock).toHaveBeenCalledWith('portal-da-sessao', 'attachment-1')
    expect(response.headers.get('Content-Disposition')).toContain('nota.pdf')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await response.text()).toBe('12345678')
  })

  it('bloqueia exclusão por VIEWER', async () => {
    contextMock.mockResolvedValue({ ...operator, role: 'VIEWER' })
    const response = await DELETE(
      new Request('https://example.test/api/inventory/attachments/attachment-1', {
        method: 'DELETE',
        headers: { authorization: 'Bearer token' },
      }),
      { params: Promise.resolve({ id: 'attachment-1' }) },
    )
    expect(response.status).toBe(403)
    expect(deleteMock).not.toHaveBeenCalled()
  })
})

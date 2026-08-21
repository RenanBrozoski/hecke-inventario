import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, tx, uploadFileMock, deleteFileMock, recordAuditEventMock } = vi.hoisted(() => {
  const txClient = {
    inventoryEquipment: { findFirst: vi.fn() },
    inventoryPerson: { findFirst: vi.fn() },
    inventoryTerm: { findFirst: vi.fn() },
    inventoryCustomRecord: { findFirst: vi.fn() },
    inventoryAttachment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    inventoryBlobCleanup: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  }
  return {
    tx: txClient,
    prismaMock: { ...txClient, $transaction: vi.fn() },
    uploadFileMock: vi.fn(),
    deleteFileMock: vi.fn(),
    recordAuditEventMock: vi.fn(),
  }
})

vi.mock('@/src/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/src/modules/storage/blob', () => ({
  uploadFile: uploadFileMock,
  deleteFile: deleteFileMock,
}))
vi.mock('@/src/modules/audit/log', () => ({ recordAuditEvent: recordAuditEventMock }))

import { InventoryValidationError } from './http'
import {
  contentDispositionAttachment,
  deleteInventoryAttachment,
  isTrustedVercelBlobUrl,
  listInventoryAttachments,
  MAX_INVENTORY_ATTACHMENT_BYTES,
  uploadInventoryAttachment,
  validateInventoryAttachmentFile,
} from './attachment-service'

function file(name: string, type: string, bytes: Buffer, size = bytes.byteLength) {
  return { name, type, bytes, size }
}

const context = {
  portalId: 'portal-1',
  bitrixUserId: 'user-1',
  userName: 'Operador',
  role: 'OPERATOR' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
    callback(tx),
  )
  tx.inventoryBlobCleanup.findMany.mockResolvedValue([])
  tx.inventoryBlobCleanup.upsert.mockResolvedValue({ id: 'cleanup-1' })
  tx.inventoryBlobCleanup.update.mockResolvedValue({ id: 'cleanup-1' })
})

describe('validateInventoryAttachmentFile', () => {
  it('aceita PDF somente quando extensão, MIME e assinatura conferem', () => {
    const bytes = Buffer.from('%PDF-1.7\nconteudo')
    expect(
      validateInventoryAttachmentFile(file('nota fiscal.pdf', 'application/pdf', bytes)),
    ).toEqual(
      expect.objectContaining({
        originalName: 'nota fiscal.pdf',
        extension: 'pdf',
        contentType: 'application/pdf',
        size: bytes.length,
      }),
    )
  })

  it('remove caminhos e controles do nome antes de persistir', () => {
    const bytes = Buffer.from('%PDF-1.7\nconteudo')
    const result = validateInventoryAttachmentFile(
      file('../pasta\\nota\r\n.pdf', 'application/pdf', bytes),
    )
    expect(result.originalName).toBe('nota.pdf')
  })

  it('rejeita MIME incompatível com a extensão', () => {
    const bytes = Buffer.from('%PDF-1.7\nconteudo')
    expect(() =>
      validateInventoryAttachmentFile(file('nota.pdf', 'image/png', bytes)),
    ).toThrowError(InventoryValidationError)
  })

  it('rejeita arquivo apenas renomeado mesmo com MIME forjado', () => {
    const bytes = Buffer.from('isto não é um pdf')
    expect(() =>
      validateInventoryAttachmentFile(file('malicioso.pdf', 'application/pdf', bytes)),
    ).toThrow('O conteúdo do arquivo não corresponde')
  })

  it('rejeita texto com byte nulo', () => {
    const bytes = Buffer.from([0x61, 0x00, 0x62])
    expect(() => validateInventoryAttachmentFile(file('dados.csv', 'text/csv', bytes))).toThrow(
      'O conteúdo do arquivo não corresponde',
    )
  })

  it('distingue planilha XLS de documento DOC dentro do contêiner OLE', () => {
    const oleSignature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    const spreadsheet = Buffer.concat([oleSignature, Buffer.from('Workbook', 'utf16le')])
    const wordDocument = Buffer.concat([oleSignature, Buffer.from('WordDocument', 'utf16le')])

    expect(
      validateInventoryAttachmentFile(file('dados.xls', 'application/vnd.ms-excel', spreadsheet)),
    ).toEqual(expect.objectContaining({ extension: 'xls' }))
    expect(() =>
      validateInventoryAttachmentFile(file('dados.xls', 'application/vnd.ms-excel', wordDocument)),
    ).toThrow('O conteúdo do arquivo não corresponde')
  })

  it('rejeita arquivos vazios e acima de 4 MB sem alocar o conteúdo gigante', () => {
    expect(() =>
      validateInventoryAttachmentFile(file('vazio.txt', 'text/plain', Buffer.alloc(0))),
    ).toThrow('entre 1 byte e 4 MB')
    expect(() =>
      validateInventoryAttachmentFile(
        file('grande.txt', 'text/plain', Buffer.from('x'), MAX_INVENTORY_ATTACHMENT_BYTES + 1),
      ),
    ).toThrow('entre 1 byte e 4 MB')
  })
})

describe('proteções do download', () => {
  it('aceita somente HTTPS do Vercel Blob', () => {
    expect(isTrustedVercelBlobUrl('https://store.public.blob.vercel-storage.com/a.pdf')).toBe(true)
    expect(isTrustedVercelBlobUrl('http://store.public.blob.vercel-storage.com/a.pdf')).toBe(false)
    expect(isTrustedVercelBlobUrl('https://blob.vercel-storage.com.evil.test/a.pdf')).toBe(false)
    expect(isTrustedVercelBlobUrl('http://127.0.0.1/internal')).toBe(false)
  })

  it('gera Content-Disposition sem permitir injeção de cabeçalho', () => {
    const header = contentDispositionAttachment("relatório d'uso\r\nX-Evil: 1.pdf")
    expect(header).not.toContain('\r')
    expect(header).not.toContain('\n')
    expect(header).toContain("filename*=UTF-8''")
    expect(header).toContain('%27')
  })
})

describe('isolamento, storage e auditoria', () => {
  it('valida o alvo no mesmo portal antes de listar e não retorna URL do blob', async () => {
    tx.inventoryEquipment.findFirst.mockResolvedValue({ id: 'eq-1' })
    tx.inventoryAttachment.findMany.mockResolvedValue([
      {
        id: 'attachment-1',
        entityType: 'EQUIPMENT',
        entityId: 'eq-1',
        originalName: 'nota.pdf',
        contentType: 'application/pdf',
        size: 12,
        description: null,
        uploadedByName: 'Operador',
        createdAt: new Date('2026-08-20T12:00:00Z'),
      },
    ])

    const result = await listInventoryAttachments('portal-1', 'EQUIPMENT', 'eq-1')

    expect(tx.inventoryEquipment.findFirst).toHaveBeenCalledWith({
      where: { id: 'eq-1', portalId: 'portal-1' },
      select: { id: true },
    })
    expect(tx.inventoryAttachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { portalId: 'portal-1', entityType: 'EQUIPMENT', entityId: 'eq-1' },
      }),
    )
    expect(result[0]).not.toHaveProperty('blobUrl')
    expect(result[0]).not.toHaveProperty('blobPathname')
  })

  it('confirma metadados e auditoria na mesma transação do upload', async () => {
    tx.inventoryEquipment.findFirst.mockResolvedValue({ id: 'eq-1' })
    uploadFileMock.mockResolvedValue({
      url: 'https://store.public.blob.vercel-storage.com/random.pdf',
      pathname: 'inventory/portal-1/equipment/eq-1/random.pdf',
      contentType: 'application/pdf',
    })
    tx.inventoryAttachment.create.mockResolvedValue({
      id: 'attachment-1',
      entityType: 'EQUIPMENT',
      entityId: 'eq-1',
      originalName: 'nota.pdf',
      contentType: 'application/pdf',
      size: 9,
      description: 'NF',
      uploadedByName: 'Operador',
      createdAt: new Date(),
    })
    const bytes = Buffer.from('%PDF-1.7')

    await uploadInventoryAttachment(context, {
      entityType: 'EQUIPMENT',
      entityId: 'eq-1',
      description: ' NF ',
      file: file('nota.pdf', 'application/pdf', bytes),
    })

    expect(uploadFileMock).toHaveBeenCalledWith(
      expect.stringMatching(/^inventory\/portal-1\/equipment\/eq-1\/nota\.pdf$/),
      bytes,
      expect.objectContaining({ contentType: 'application/pdf', addRandomSuffix: true }),
    )
    expect(tx.inventoryAttachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ portalId: 'portal-1', description: 'NF' }),
    })
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inventory_attachment_created',
        portalId: 'portal-1',
        entityId: 'attachment-1',
      }),
      tx,
    )
  })

  it('apaga o blob como compensação quando a transação do upload falha', async () => {
    tx.inventoryEquipment.findFirst.mockResolvedValue({ id: 'eq-1' })
    const blobUrl = 'https://store.public.blob.vercel-storage.com/random.pdf'
    uploadFileMock.mockResolvedValue({
      url: blobUrl,
      pathname: 'inventory/portal-1/equipment/eq-1/random.pdf',
      contentType: 'application/pdf',
    })
    deleteFileMock.mockResolvedValue(undefined)
    prismaMock.$transaction.mockRejectedValueOnce(new Error('falha no banco'))
    const bytes = Buffer.from('%PDF-1.7')

    await expect(
      uploadInventoryAttachment(context, {
        entityType: 'EQUIPMENT',
        entityId: 'eq-1',
        file: file('nota.pdf', 'application/pdf', bytes),
      }),
    ).rejects.toThrow('falha no banco')

    expect(deleteFileMock).toHaveBeenCalledWith(blobUrl)
  })

  it('confirma metadados + outbox antes de remover o blob e audita a exclusão', async () => {
    const attachment = {
      id: 'attachment-1',
      portalId: 'portal-1',
      entityType: 'PERSON',
      entityId: 'person-1',
      blobUrl: 'https://store.public.blob.vercel-storage.com/random.pdf',
      originalName: 'termo.pdf',
      size: 20,
    }
    tx.inventoryAttachment.findFirst.mockResolvedValue(attachment)
    tx.inventoryPerson.findFirst.mockResolvedValue({ id: 'person-1' })
    deleteFileMock.mockResolvedValue(undefined)

    await expect(deleteInventoryAttachment(context, 'attachment-1')).resolves.toEqual({
      id: 'attachment-1',
      deleted: true,
    })

    expect(deleteFileMock).toHaveBeenCalledWith(attachment.blobUrl)
    expect(tx.inventoryBlobCleanup.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { blobUrl: attachment.blobUrl } }),
    )
    expect(tx.inventoryAttachment.delete).toHaveBeenCalledWith({ where: { id: 'attachment-1' } })
    expect(tx.inventoryAttachment.delete.mock.invocationCallOrder[0]).toBeLessThan(
      deleteFileMock.mock.invocationCallOrder[0]!,
    )
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inventory_attachment_deleted', portalId: 'portal-1' }),
      tx,
    )
  })

  it('mantém a limpeza pendente quando o provedor de blob falha', async () => {
    const attachment = {
      id: 'attachment-2',
      portalId: 'portal-1',
      entityType: 'PERSON',
      entityId: 'person-1',
      blobUrl: 'https://store.public.blob.vercel-storage.com/falha.pdf',
      originalName: 'falha.pdf',
      size: 20,
    }
    tx.inventoryAttachment.findFirst.mockResolvedValue(attachment)
    tx.inventoryPerson.findFirst.mockResolvedValue({ id: 'person-1' })
    deleteFileMock.mockRejectedValue(new Error('blob indisponível'))

    await expect(deleteInventoryAttachment(context, 'attachment-2')).resolves.toEqual({
      id: 'attachment-2',
      deleted: true,
    })
    expect(tx.inventoryBlobCleanup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cleanup-1' },
        data: expect.objectContaining({ lastError: 'blob indisponível' }),
      }),
    )
  })
})

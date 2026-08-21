import type { InventoryAttachmentEntityType, PrismaClient } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { recordAuditEvent } from '@/src/modules/audit/log'
import { deleteFile, uploadFile } from '@/src/modules/storage/blob'
import { type InventoryContext, InventoryNotFoundError, InventoryValidationError } from './http'

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

// Upload/download passam pela Function autenticada. Mantemos margem abaixo do
// limite de payload da Vercel; elevar para 20 MB exige upload direto ao Blob
// com callback seguro e outra estratégia de download autenticado.
export const MAX_INVENTORY_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const MAX_INVENTORY_ATTACHMENT_REQUEST_BYTES = MAX_INVENTORY_ATTACHMENT_BYTES + 256 * 1024

const CONTENT_TYPES_BY_EXTENSION = {
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  txt: ['text/plain'],
  csv: ['text/csv', 'application/csv', 'text/comma-separated-values'],
} as const

export const INVENTORY_ATTACHMENT_ACCEPT = Object.keys(CONTENT_TYPES_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(',')

type AllowedExtension = keyof typeof CONTENT_TYPES_BY_EXTENSION

export interface AttachmentFileInput {
  name: string
  type: string
  size: number
  bytes: Buffer
}

export interface ValidatedAttachmentFile {
  originalName: string
  extension: AllowedExtension
  contentType: string
  size: number
  bytes: Buffer
}

export interface InventoryAttachmentView {
  id: string
  entityType: InventoryAttachmentEntityType
  entityId: string
  originalName: string
  contentType: string | null
  size: number
  description: string | null
  uploadedByName: string | null
  createdAt: Date
}

function cleanupErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000)
}

async function attemptBlobCleanup(cleanupId: string, blobUrl: string): Promise<void> {
  try {
    await deleteFile(blobUrl)
    await prisma.inventoryBlobCleanup.update({
      where: { id: cleanupId },
      data: { completedAt: new Date(), attempts: { increment: 1 }, lastError: null },
    })
  } catch (error) {
    // A linha da outbox já foi confirmada antes da chamada externa. Mesmo que
    // este update falhe, uma execução futura ainda encontrará o item pendente.
    await prisma.inventoryBlobCleanup
      .update({
        where: { id: cleanupId },
        data: { attempts: { increment: 1 }, lastError: cleanupErrorMessage(error) },
      })
      .catch(() => undefined)
  }
}

export async function retryPendingInventoryBlobCleanups(
  portalId: string,
  limit = 5,
): Promise<void> {
  const pending = await prisma.inventoryBlobCleanup.findMany({
    where: { portalId, completedAt: null },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(limit, 25)),
  })
  for (const cleanup of pending) await attemptBlobCleanup(cleanup.id, cleanup.blobUrl)
}

function cleanOriginalName(value: string): string {
  const leaf = value.replaceAll('\\', '/').split('/').pop() ?? ''
  const cleaned = leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!cleaned) throw new InventoryValidationError('O arquivo precisa ter um nome válido.')
  if (cleaned.length <= 255) return cleaned

  const dot = cleaned.lastIndexOf('.')
  const suffix = dot > 0 ? cleaned.slice(dot) : ''
  return `${cleaned.slice(0, Math.max(1, 255 - suffix.length))}${suffix}`
}

function safeBlobName(originalName: string): string {
  const dot = originalName.lastIndexOf('.')
  const extension = dot > 0 ? originalName.slice(dot).toLowerCase() : ''
  const base = (dot > 0 ? originalName.slice(0, dot) : originalName)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${base || 'arquivo'}${extension}`
}

function startsWith(bytes: Buffer, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function isZip(bytes: Buffer): boolean {
  return (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  )
}

function isOleCompoundDocument(bytes: Buffer): boolean {
  return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
}

function includesUtf16Le(bytes: Buffer, value: string): boolean {
  return bytes.includes(Buffer.from(value, 'utf16le'))
}

function isUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

function contentMatchesExtension(extension: AllowedExtension, bytes: Buffer): boolean {
  switch (extension) {
    case 'pdf':
      return bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    case 'png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'jpg':
    case 'jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff])
    case 'gif': {
      const signature = bytes.subarray(0, 6).toString('ascii')
      return signature === 'GIF87a' || signature === 'GIF89a'
    }
    case 'webp':
      return (
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WEBP'
      )
    case 'doc':
      return isOleCompoundDocument(bytes) && includesUtf16Le(bytes, 'WordDocument')
    case 'xls':
      return (
        isOleCompoundDocument(bytes) &&
        (includesUtf16Le(bytes, 'Workbook') || includesUtf16Le(bytes, 'Book'))
      )
    case 'docx':
      return (
        isZip(bytes) &&
        bytes.includes(Buffer.from('[Content_Types].xml')) &&
        bytes.includes(Buffer.from('word/document.xml'))
      )
    case 'xlsx':
      return (
        isZip(bytes) &&
        bytes.includes(Buffer.from('[Content_Types].xml')) &&
        bytes.includes(Buffer.from('xl/workbook.xml'))
      )
    case 'txt':
    case 'csv':
      return isUtf8Text(bytes)
  }
}

/**
 * Valida nome, tamanho, MIME e assinatura/conteúdo. A extensão nunca é
 * aceita sozinha: isso impede que um executável apenas renomeado seja enviado.
 */
export function validateInventoryAttachmentFile(
  input: AttachmentFileInput,
): ValidatedAttachmentFile {
  const originalName = cleanOriginalName(input.name)
  if (
    !Number.isSafeInteger(input.size) ||
    input.size <= 0 ||
    input.size > MAX_INVENTORY_ATTACHMENT_BYTES ||
    input.bytes.byteLength !== input.size
  ) {
    throw new InventoryValidationError('O arquivo deve ter entre 1 byte e 4 MB.')
  }

  const dot = originalName.lastIndexOf('.')
  const extension = (dot > 0 ? originalName.slice(dot + 1).toLowerCase() : '') as AllowedExtension
  if (!Object.hasOwn(CONTENT_TYPES_BY_EXTENSION, extension)) {
    throw new InventoryValidationError('Tipo de arquivo não permitido.')
  }

  const contentType = (input.type.split(';', 1)[0] ?? '').trim().toLowerCase()
  const acceptedTypes = CONTENT_TYPES_BY_EXTENSION[extension] as readonly string[]
  if (!contentType || !acceptedTypes.includes(contentType)) {
    throw new InventoryValidationError('O tipo MIME não corresponde à extensão do arquivo.')
  }
  if (!contentMatchesExtension(extension, input.bytes)) {
    throw new InventoryValidationError('O conteúdo do arquivo não corresponde ao tipo informado.')
  }

  return { originalName, extension, contentType, size: input.size, bytes: input.bytes }
}

function attachmentView(attachment: InventoryAttachmentView): InventoryAttachmentView {
  return {
    id: attachment.id,
    entityType: attachment.entityType,
    entityId: attachment.entityId,
    originalName: attachment.originalName,
    contentType: attachment.contentType,
    size: attachment.size,
    description: attachment.description,
    uploadedByName: attachment.uploadedByName,
    createdAt: attachment.createdAt,
  }
}

async function assertAttachmentTarget(
  client: TransactionClient,
  portalId: string,
  entityType: InventoryAttachmentEntityType,
  entityId: string,
): Promise<void> {
  let exists = false
  switch (entityType) {
    case 'EQUIPMENT':
      exists = Boolean(
        await client.inventoryEquipment.findFirst({
          where: { id: entityId, portalId },
          select: { id: true },
        }),
      )
      break
    case 'PERSON':
      exists = Boolean(
        await client.inventoryPerson.findFirst({
          where: { id: entityId, portalId },
          select: { id: true },
        }),
      )
      break
    case 'TERM':
      exists = Boolean(
        await client.inventoryTerm.findFirst({
          where: { id: entityId, portalId },
          select: { id: true },
        }),
      )
      break
    case 'CUSTOM_RECORD':
      exists = Boolean(
        await client.inventoryCustomRecord.findFirst({
          where: { id: entityId, portalId },
          select: { id: true },
        }),
      )
      break
  }
  if (!exists) throw new InventoryNotFoundError('Registro de destino do anexo não encontrado.')
}

export async function listInventoryAttachments(
  portalId: string,
  entityType: InventoryAttachmentEntityType,
  entityId: string,
): Promise<InventoryAttachmentView[]> {
  await assertAttachmentTarget(prisma, portalId, entityType, entityId)
  const attachments = await prisma.inventoryAttachment.findMany({
    where: { portalId, entityType, entityId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      entityType: true,
      entityId: true,
      originalName: true,
      contentType: true,
      size: true,
      description: true,
      uploadedByName: true,
      createdAt: true,
    },
  })
  return attachments.map(attachmentView)
}

export async function uploadInventoryAttachment(
  context: InventoryContext,
  input: {
    entityType: InventoryAttachmentEntityType
    entityId: string
    description?: string | null
    file: AttachmentFileInput
  },
): Promise<InventoryAttachmentView> {
  const file = validateInventoryAttachmentFile(input.file)
  const description = input.description?.trim() || null
  if (description && description.length > 500) {
    throw new InventoryValidationError('A descrição deve ter no máximo 500 caracteres.')
  }
  await retryPendingInventoryBlobCleanups(context.portalId, 2).catch(() => undefined)

  // Valida antes de chamar um serviço externo e repete dentro da transação.
  await assertAttachmentTarget(prisma, context.portalId, input.entityType, input.entityId)
  const pathname = [
    'inventory',
    context.portalId,
    input.entityType.toLowerCase(),
    input.entityId,
    safeBlobName(file.originalName),
  ].join('/')
  const uploaded = await uploadFile(pathname, file.bytes, {
    contentType: file.contentType,
    addRandomSuffix: true,
  })

  try {
    return await prisma.$transaction(async (tx) => {
      await assertAttachmentTarget(tx, context.portalId, input.entityType, input.entityId)
      const attachment = await tx.inventoryAttachment.create({
        data: {
          portalId: context.portalId,
          entityType: input.entityType,
          entityId: input.entityId,
          blobUrl: uploaded.url,
          blobPathname: uploaded.pathname,
          originalName: file.originalName,
          contentType: file.contentType,
          size: file.size,
          description,
          uploadedByBitrixUserId: context.bitrixUserId,
          uploadedByName: context.userName,
        },
      })
      await recordAuditEvent(
        {
          portalId: context.portalId,
          bitrixUserId: context.bitrixUserId,
          action: 'inventory_attachment_created',
          entityType: 'InventoryAttachment',
          entityId: attachment.id,
          metadata: {
            targetType: input.entityType,
            targetId: input.entityId,
            originalName: file.originalName,
            size: file.size,
          },
        },
        tx,
      )
      return attachmentView(attachment)
    })
  } catch (error) {
    // Compensa o upload caso metadados + auditoria não consigam ser confirmados.
    try {
      await deleteFile(uploaded.url)
    } catch (cleanupError) {
      await prisma.inventoryBlobCleanup.upsert({
        where: { blobUrl: uploaded.url },
        update: {
          completedAt: null,
          reason: 'UPLOAD_COMPENSATION',
          lastError: cleanupErrorMessage(cleanupError),
          attempts: { increment: 1 },
        },
        create: {
          portalId: context.portalId,
          blobUrl: uploaded.url,
          reason: 'UPLOAD_COMPENSATION',
          attempts: 1,
          lastError: cleanupErrorMessage(cleanupError),
        },
      })
    }
    throw error
  }
}

export async function getInventoryAttachmentForDownload(portalId: string, attachmentId: string) {
  const attachment = await prisma.inventoryAttachment.findFirst({
    where: { id: attachmentId, portalId },
  })
  if (!attachment) throw new InventoryNotFoundError('Anexo não encontrado.')
  await assertAttachmentTarget(prisma, portalId, attachment.entityType, attachment.entityId)
  return attachment
}

export async function deleteInventoryAttachment(
  context: InventoryContext,
  attachmentId: string,
): Promise<{ id: string; deleted: true }> {
  const attachment = await prisma.inventoryAttachment.findFirst({
    where: { id: attachmentId, portalId: context.portalId },
  })
  if (!attachment) throw new InventoryNotFoundError('Anexo não encontrado.')
  await assertAttachmentTarget(prisma, context.portalId, attachment.entityType, attachment.entityId)

  const committed = await prisma.$transaction(async (tx) => {
    const current = await tx.inventoryAttachment.findFirst({
      where: { id: attachmentId, portalId: context.portalId },
    })
    if (!current) throw new InventoryNotFoundError('Anexo não encontrado.')
    await assertAttachmentTarget(tx, context.portalId, current.entityType, current.entityId)
    const cleanup = await tx.inventoryBlobCleanup.upsert({
      where: { blobUrl: current.blobUrl },
      update: { completedAt: null, reason: 'ATTACHMENT_DELETED', lastError: null },
      create: {
        portalId: context.portalId,
        blobUrl: current.blobUrl,
        reason: 'ATTACHMENT_DELETED',
      },
    })
    await tx.inventoryAttachment.delete({ where: { id: current.id } })
    await recordAuditEvent(
      {
        portalId: context.portalId,
        bitrixUserId: context.bitrixUserId,
        action: 'inventory_attachment_deleted',
        entityType: 'InventoryAttachment',
        entityId: current.id,
        metadata: {
          targetType: current.entityType,
          targetId: current.entityId,
          originalName: current.originalName,
          size: current.size,
        },
      },
      tx,
    )
    return {
      result: { id: current.id, deleted: true as const },
      cleanupId: cleanup.id,
      blobUrl: current.blobUrl,
    }
  })
  // A referência é removida atomicamente antes da chamada externa. Falhas do
  // Blob ficam na outbox e são repetidas com segurança em mutações futuras.
  await attemptBlobCleanup(committed.cleanupId, committed.blobUrl)
  return committed.result
}

export function isTrustedVercelBlobUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'blob.vercel-storage.com' ||
        url.hostname.endsWith('.blob.vercel-storage.com'))
    )
  } catch {
    return false
  }
}

export function contentDispositionAttachment(filename: string): string {
  const ascii =
    filename
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/["\\]/g, '_')
      .trim() || 'arquivo'
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

import { z } from 'zod'
import {
  MAX_INVENTORY_ATTACHMENT_REQUEST_BYTES,
  listInventoryAttachments,
  uploadInventoryAttachment,
} from '@/src/modules/inventory/attachment-service'
import {
  inventoryErrorResponse,
  InventoryValidationError,
  jsonOk,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const entityTypeSchema = z.enum(['EQUIPMENT', 'PERSON', 'TERM', 'CUSTOM_RECORD'])
const targetSchema = z
  .object({
    entityType: entityTypeSchema,
    entityId: z.string().trim().min(1).max(191),
  })
  .strict()

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const target = targetSchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    )
    return jsonOk({
      items: await listInventoryAttachments(portalId, target.entityType, target.entityId),
    })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')

    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_INVENTORY_ATTACHMENT_REQUEST_BYTES) {
      throw new InventoryValidationError('O arquivo excede o limite de 4 MB.')
    }

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new InventoryValidationError('Formulário de upload inválido.')
    }
    const target = targetSchema.parse({
      entityType: form.get('entityType'),
      entityId: form.get('entityId'),
    })
    const descriptionValue = form.get('description')
    if (descriptionValue !== null && typeof descriptionValue !== 'string') {
      throw new InventoryValidationError('Descrição inválida.')
    }
    const file = form.get('file')
    if (!(file instanceof File)) {
      throw new InventoryValidationError('Selecione um arquivo para anexar.')
    }

    const attachment = await uploadInventoryAttachment(context, {
      ...target,
      description: descriptionValue,
      file: {
        name: file.name,
        type: file.type,
        size: file.size,
        bytes: Buffer.from(await file.arrayBuffer()),
      },
    })
    return jsonOk(attachment, 201)
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

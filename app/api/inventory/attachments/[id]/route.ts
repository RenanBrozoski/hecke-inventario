import { NextResponse } from 'next/server'
import {
  contentDispositionAttachment,
  deleteInventoryAttachment,
  getInventoryAttachmentForDownload,
  isTrustedVercelBlobUrl,
} from '@/src/modules/inventory/attachment-service'
import {
  inventoryErrorResponse,
  jsonOk,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, route: RouteContext) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const { id } = await route.params
    const attachment = await getInventoryAttachmentForDownload(portalId, id)
    if (!isTrustedVercelBlobUrl(attachment.blobUrl)) {
      return NextResponse.json(
        { error: 'Armazenamento do anexo inválido.' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const upstream = await fetch(attachment.blobUrl, {
      cache: 'no-store',
      redirect: 'error',
    })
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: 'Não foi possível recuperar o anexo.' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': contentDispositionAttachment(attachment.originalName),
        'Content-Length': String(attachment.size),
        'Content-Type': attachment.contentType || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function DELETE(request: Request, route: RouteContext) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')
    const { id } = await route.params
    return jsonOk(await deleteInventoryAttachment(context, id))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

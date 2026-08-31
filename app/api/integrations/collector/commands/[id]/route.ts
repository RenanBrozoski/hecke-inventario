import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { markCommandDone } from '@/src/modules/inventory/collector-commands'
import { InventoryNotFoundError } from '@/src/modules/inventory/http'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

function validToken(received: string | null, expected: string): boolean {
  if (!received) return false
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

const bodySchema = z.object({
  portalDomain: z.string().trim().min(3).toLowerCase(),
  success: z.boolean(),
  result: z.string().max(500).nullable().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const expectedToken = process.env.COLLECTOR_SYNC_TOKEN
  if (!expectedToken)
    return NextResponse.json({ error: 'Integração não configurada.' }, { status: 503 })
  if (!validToken(request.headers.get('x-collector-token'), expectedToken))
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  try {
    const { id } = await params
    const { portalDomain, success, result } = bodySchema.parse(await request.json())

    const portal = await prisma.bitrixPortal.findUnique({
      where: { domain: portalDomain },
      select: { id: true },
    })
    if (!portal) throw new InventoryNotFoundError('Portal não encontrado.')

    await markCommandDone(portal.id, id, success, result ?? null)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof InventoryNotFoundError)
      return NextResponse.json({ error: error.message }, { status: 404 })
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 })
  }
}

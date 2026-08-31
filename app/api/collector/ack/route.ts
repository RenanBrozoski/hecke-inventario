import { NextResponse } from 'next/server'
import { z } from 'zod'
import { markCommandDone } from '@/src/modules/inventory/collector-commands'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

function requireToken(request: Request): boolean {
  const expected = process.env.COLLECTOR_SYNC_TOKEN
  if (!expected) return false
  const auth = request.headers.get('Authorization') ?? ''
  return auth === `Bearer ${expected}`
}

const bodySchema = z.object({
  portalDomain: z.string().trim().min(3).max(255).toLowerCase(),
  commandId: z.string().cuid(),
  success: z.boolean(),
  result: z.string().max(500).nullable().optional(),
})

export async function POST(request: Request) {
  if (!requireToken(request)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  try {
    const { portalDomain, commandId, success, result } = bodySchema.parse(await request.json())

    const portal = await prisma.bitrixPortal.findUnique({
      where: { domain: portalDomain },
      select: { id: true },
    })
    if (!portal) {
      return NextResponse.json({ error: 'Portal não encontrado.' }, { status: 404 })
    }

    await markCommandDone(portal.id, commandId, success, result ?? null)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Payload inválido.', errors: error.issues }, { status: 400 })
    }
    const message = error instanceof Error ? error.message : 'Erro interno.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

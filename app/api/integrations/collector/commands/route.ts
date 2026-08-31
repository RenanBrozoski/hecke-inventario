import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPendingCommands } from '@/src/modules/inventory/collector-commands'
import { InventoryNotFoundError } from '@/src/modules/inventory/http'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

function validToken(received: string | null, expected: string): boolean {
  if (!received) return false
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

const querySchema = z.object({
  portalDomain: z.string().trim().min(3).toLowerCase(),
  serial: z.string().trim().max(200).optional(),
  name: z.string().trim().max(200).optional(),
})

export async function GET(request: Request) {
  const expectedToken = process.env.COLLECTOR_SYNC_TOKEN
  if (!expectedToken)
    return NextResponse.json({ error: 'Integração não configurada.' }, { status: 503 })
  if (!validToken(request.headers.get('x-collector-token'), expectedToken))
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const { portalDomain, serial, name } = querySchema.parse({
      portalDomain: searchParams.get('portalDomain'),
      serial: searchParams.get('serial') ?? undefined,
      name: searchParams.get('name') ?? undefined,
    })

    const portal = await prisma.bitrixPortal.findUnique({
      where: { domain: portalDomain },
      select: { id: true },
    })
    if (!portal) throw new InventoryNotFoundError('Portal não encontrado.')

    const commands = await getPendingCommands(portal.id, serial ?? null, name ?? null)
    return NextResponse.json({ commands })
  } catch (error) {
    if (error instanceof InventoryNotFoundError)
      return NextResponse.json({ error: error.message }, { status: 404 })
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { collectorSyncPayloadSchema, syncCollectorMachine } from '@/src/modules/inventory/collector-sync'
import { getPendingCommands } from '@/src/modules/inventory/collector-commands'
import { InventoryNotFoundError, InventoryValidationError } from '@/src/modules/inventory/http'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

function requireToken(request: Request): boolean {
  const expected = process.env.COLLECTOR_SYNC_TOKEN
  if (!expected) return false
  const auth = request.headers.get('Authorization') ?? ''
  return auth === `Bearer ${expected}`
}

export async function POST(request: Request) {
  if (!requireToken(request)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  try {
    const body = collectorSyncPayloadSchema.parse(await request.json())
    const result = await syncCollectorMachine(body)

    if (result.conflict) {
      return NextResponse.json({ sync: result, commands: [] })
    }

    const portal = await prisma.bitrixPortal.findUnique({
      where: { domain: body.portalDomain },
      select: { id: true },
    })

    const commands = portal
      ? await getPendingCommands(
          portal.id,
          body.machine.serialNumber ?? null,
          body.machine.name,
        )
      : []

    return NextResponse.json({ sync: result, commands })
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: 'Payload inválido.', errors: error.issues }, { status: 400 })
    if (error instanceof InventoryValidationError)
      return NextResponse.json({ error: error.message }, { status: 400 })
    if (error instanceof InventoryNotFoundError)
      return NextResponse.json({ error: error.message }, { status: 404 })
    const message = error instanceof Error ? error.message : 'Erro interno.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

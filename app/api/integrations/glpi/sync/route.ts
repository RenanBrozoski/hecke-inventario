import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { glpiSyncPayloadSchema, syncGlpiComputers } from '@/src/modules/inventory/glpi-sync'
import { InventoryNotFoundError, InventoryValidationError } from '@/src/modules/inventory/http'

export const dynamic = 'force-dynamic'

function validToken(received: string | null, expected: string): boolean {
  if (!received) return false
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function POST(request: Request) {
  const expectedToken = process.env.GLPI_SYNC_TOKEN
  if (!expectedToken) {
    return NextResponse.json({ error: 'Integração GLPI não configurada.' }, { status: 503 })
  }
  if (!validToken(request.headers.get('x-glpi-sync-token'), expectedToken)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  try {
    const payload = glpiSyncPayloadSchema.parse(await request.json())
    return NextResponse.json({ ok: true, ...(await syncGlpiComputers(payload)) })
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: 'Payload inválido.', errors: error.issues }, { status: 400 })
    if (error instanceof InventoryValidationError || error instanceof InventoryNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: error instanceof InventoryNotFoundError ? 404 : 400 })
    }
    return NextResponse.json({ error: 'Erro interno na sincronização GLPI.' }, { status: 500 })
  }
}

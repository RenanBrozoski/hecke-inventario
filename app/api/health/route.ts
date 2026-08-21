import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { logger } from '@/src/modules/common/logger'

export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  let databaseOk = true

  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (error) {
    databaseOk = false
    logger.error({ err: error }, 'health check: falha ao conectar no banco')
  }

  const body = {
    status: databaseOk ? 'ok' : 'degraded',
    checks: {
      database: databaseOk ? 'ok' : 'error',
      // Informativos: ausência não derruba o healthcheck nesta fase, já que
      // Blob/Inngest podem ainda não ter sido configurados no ambiente.
      blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      inngestConfigured: Boolean(process.env.INNGEST_EVENT_KEY),
    },
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  }

  return NextResponse.json(body, { status: databaseOk ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}

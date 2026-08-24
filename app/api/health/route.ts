import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { logger } from '@/src/modules/common/logger'

export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  let databaseOk = true
  // Diagnóstico: o que ESTE processo (produção) enxerga no banco. Se divergir
  // do que uma conexão externa vê com a mesma connection string, a DATABASE_URL
  // de produção aponta para outro banco/branch. Só contagens e nome do banco —
  // nenhum dado sensível.
  let dbName: string | null = null
  let portalCount: number | null = null
  let userCount: number | null = null

  try {
    const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database()::text AS db`
    dbName = rows[0]?.db ?? null
    portalCount = await prisma.bitrixPortal.count()
    userCount = await prisma.bitrixUser.count()
  } catch (error) {
    databaseOk = false
    logger.error({ err: error }, 'health check: falha ao conectar no banco')
  }

  const body = {
    status: databaseOk ? 'ok' : 'degraded',
    checks: {
      database: databaseOk ? 'ok' : 'error',
      dbName,
      portalCount,
      userCount,
      // Informativos: ausência não derruba o healthcheck nesta fase, já que
      // Blob/Inngest podem ainda não ter sido configurados no ambiente.
      blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      inngestConfigured: Boolean(process.env.INNGEST_EVENT_KEY),
      // Estes DERRUBAM a sessão quando faltam, e a falha só aparecia como
      // "não foi possível estabelecer a sessão" na tela: issueSessionToken()
      // exige SESSION_JWT_SECRET com 16+ caracteres e a criptografia dos
      // tokens do portal exige BITRIX_TOKEN_ENCRYPTION_KEY. Booleano apenas —
      // nunca o valor.
      sessionSecretConfigured: (process.env.SESSION_JWT_SECRET ?? '').length >= 16,
      bitrixEncryptionKeyConfigured: Boolean(process.env.BITRIX_TOKEN_ENCRYPTION_KEY),
      bitrixCredentialsConfigured:
        Boolean(process.env.BITRIX_CLIENT_ID) && Boolean(process.env.BITRIX_CLIENT_SECRET),
      frameAncestorsConfigured: Boolean(process.env.BITRIX_EXTRA_FRAME_ANCESTORS),
    },
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  }

  return NextResponse.json(body, {
    status: databaseOk ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}

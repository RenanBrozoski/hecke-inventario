import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

neonConfig.webSocketConstructor = ws

declare global {
  var __prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    // Não lançamos aqui de propósito: isso rodaria no import do módulo (inclusive
    // durante `next build`), antes de o projeto Neon existir. A primeira query
    // real vai falhar com um erro claro em vez de derrubar o build/scaffold.
    console.warn(
      '[prisma] DATABASE_URL não definida — configure o .env antes de usar o banco.',
    )
  }

  // A partir do adapter-neon 6.x, o adapter recebe a config diretamente
  // (ele mesmo cria e gerencia o Pool internamente).
  const adapter = new PrismaNeon({ connectionString: connectionString ?? '' })
  return new PrismaClient({ adapter })
}

export const prisma = globalThis.__prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma
}

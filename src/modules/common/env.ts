import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),
  DIRECT_URL: z.string().min(1).optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  SESSION_JWT_SECRET: z.string().min(16).optional(),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Fase 1 — Aplicativo Local do Bitrix24. Ficam opcionais aqui (getEnv() é usado por
  // rotas que não mexem com Bitrix, ex. /api/health) — quem exige de fato é cada
  // módulo no ponto de uso (ver src/modules/bitrix/crypto.ts, src/modules/auth/session.ts).
  BITRIX_CLIENT_ID: z.string().optional(),
  BITRIX_CLIENT_SECRET: z.string().optional(),
  BITRIX_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  // Lista (CSV) de origens extras autorizadas a exibir o app em iframe, além dos
  // domínios de portais BitrixPortal ativos — ver src/modules/bitrix/frame-ancestors.ts.
  BITRIX_EXTRA_FRAME_ANCESTORS: z.string().optional(),
  // Lista (CSV) de administradores extras no formato "portalId:bitrixUserId"
  // (escopado por portal — nunca um bitrixUserId "solto"), além de quem
  // instalou o app — ver src/modules/bitrix/admin.ts (heurística temporária,
  // substituída pelo módulo de permissões na Fase 4).
  BITRIX_EXTRA_ADMIN_USER_IDS: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | null = null

/**
 * Validação sob demanda (não no import do módulo): assim `next build` não quebra
 * antes de existir um `.env` local, e o erro só aparece quando algo tenta
 * de fato usar uma variável ausente.
 */
export function getEnv(): Env {
  if (cached) return cached

  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    console.error('Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors)
    throw new Error('Configuração de ambiente inválida — verifique o .env (veja .env.example)')
  }

  cached = parsed.data
  return cached
}

/** Só para os testes: permite forçar uma nova validação. */
export function __resetEnvCacheForTests(): void {
  cached = null
}

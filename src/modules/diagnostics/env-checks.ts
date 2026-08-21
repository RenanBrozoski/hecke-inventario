import { check, type DiagnosticCheck } from './types'

function isPlaceholder(value: string): boolean {
  return /xxxx|user:password|gere-um-valor|seu-|change-?me/i.test(value)
}

/**
 * Checks de configuração — nunca fazem I/O (sem banco, sem rede). Cada um
 * relata só presença/formato/comprimento de variável — NUNCA o valor de um
 * segredo. Usado tanto pelo script de linha de comando (scripts/check-env.ts)
 * quanto pela tela de diagnóstico administrativa (/admin/diagnostics).
 */
export function runEnvChecks(): DiagnosticCheck[] {
  const results: DiagnosticCheck[] = []
  const env = process.env

  // --- Banco de dados ---
  if (!env.DATABASE_URL) {
    results.push(check('database_url', 'DATABASE_URL', 'error', 'Não definida.'))
  } else if (isPlaceholder(env.DATABASE_URL)) {
    results.push(check('database_url', 'DATABASE_URL', 'error', 'Definida, mas ainda é o valor de exemplo do .env.example.'))
  } else if (!env.DATABASE_URL.includes('-pooler')) {
    results.push(check('database_url', 'DATABASE_URL', 'warning', 'Definida, mas o host não contém "-pooler" — confirme que é a connection string pooled do Neon.'))
  } else {
    results.push(check('database_url', 'DATABASE_URL', 'ok', 'Definida (connection string pooled).'))
  }

  if (!env.DIRECT_URL) {
    results.push(check('direct_url', 'DIRECT_URL', 'error', 'Não definida — necessária para `prisma migrate`.'))
  } else if (isPlaceholder(env.DIRECT_URL)) {
    results.push(check('direct_url', 'DIRECT_URL', 'error', 'Definida, mas ainda é o valor de exemplo do .env.example.'))
  } else if (env.DIRECT_URL.includes('-pooler')) {
    results.push(check('direct_url', 'DIRECT_URL', 'warning', 'Contém "-pooler" — DIRECT_URL deveria ser a conexão SEM pooler.'))
  } else {
    results.push(check('direct_url', 'DIRECT_URL', 'ok', 'Definida (conexão direta).'))
  }

  // --- Bitrix24 ---
  results.push(
    env.BITRIX_CLIENT_ID
      ? check('bitrix_client_id', 'BITRIX_CLIENT_ID', 'ok', 'Definida.')
      : check('bitrix_client_id', 'BITRIX_CLIENT_ID', 'error', 'Não definida — obrigatória para o handshake OAuth do Aplicativo Local.'),
  )
  results.push(
    env.BITRIX_CLIENT_SECRET
      ? check('bitrix_client_secret', 'BITRIX_CLIENT_SECRET', 'ok', 'Definida.')
      : check('bitrix_client_secret', 'BITRIX_CLIENT_SECRET', 'error', 'Não definida — obrigatória para o handshake OAuth do Aplicativo Local.'),
  )

  // --- Criptografia dos tokens do Bitrix24 ---
  if (!env.BITRIX_TOKEN_ENCRYPTION_KEY) {
    results.push(check('bitrix_token_encryption_key', 'BITRIX_TOKEN_ENCRYPTION_KEY', 'error', 'Não definida — necessária para (des)criptografar os tokens salvos em BitrixPortal.'))
  } else {
    const decoded = Buffer.from(env.BITRIX_TOKEN_ENCRYPTION_KEY, 'base64')
    results.push(
      decoded.length === 32
        ? check('bitrix_token_encryption_key', 'BITRIX_TOKEN_ENCRYPTION_KEY', 'ok', 'Definida e decodifica para 32 bytes.')
        : check('bitrix_token_encryption_key', 'BITRIX_TOKEN_ENCRYPTION_KEY', 'error', `Definida, mas decodifica para ${decoded.length} bytes (precisa ser exatamente 32).`),
    )
  }

  // --- Sessão ---
  if (!env.SESSION_JWT_SECRET) {
    results.push(check('session_jwt_secret', 'SESSION_JWT_SECRET', 'error', 'Não definida — necessária para assinar a sessão emitida após o handshake.'))
  } else {
    results.push(
      env.SESSION_JWT_SECRET.length >= 32
        ? check('session_jwt_secret', 'SESSION_JWT_SECRET', 'ok', `Definida (${env.SESSION_JWT_SECRET.length} caracteres).`)
        : check('session_jwt_secret', 'SESSION_JWT_SECRET', 'warning', `Definida, mas curta (${env.SESSION_JWT_SECRET.length} caracteres) — recomendado 32+.`),
    )
  }

  // --- Inngest ---
  if (env.NODE_ENV === 'production') {
    results.push(
      env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY
        ? check('inngest', 'Inngest', 'ok', 'INNGEST_EVENT_KEY e INNGEST_SIGNING_KEY definidas.')
        : check('inngest', 'Inngest', 'error', 'Faltam INNGEST_EVENT_KEY e/ou INNGEST_SIGNING_KEY — obrigatórias em produção (em dev, o `inngest-cli dev` dispensa).'),
    )
  } else {
    results.push(check('inngest', 'Inngest', 'ok', 'Ambiente de desenvolvimento — `inngest-cli dev` descobre o endpoint automaticamente, chaves não são necessárias.'))
  }

  // --- Vercel Blob ---
  results.push(
    env.BLOB_READ_WRITE_TOKEN
      ? check('vercel_blob', 'Vercel Blob (BLOB_READ_WRITE_TOKEN)', 'ok', 'Definida.')
      : check('vercel_blob', 'Vercel Blob (BLOB_READ_WRITE_TOKEN)', 'warning', 'Não definida — upload real de arquivo (Fase 5) não vai funcionar sem isso.'),
  )

  // --- URL pública / frame-ancestors ---
  if (!env.APP_BASE_URL) {
    results.push(check('app_base_url', 'APP_BASE_URL', 'error', 'Não definida.'))
  } else if (env.APP_BASE_URL.includes('localhost')) {
    results.push(
      check(
        'app_base_url',
        'APP_BASE_URL',
        env.NODE_ENV === 'production' ? 'error' : 'ok',
        env.NODE_ENV === 'production'
          ? 'Aponta para localhost em produção — configure a URL pública real da Vercel.'
          : 'Aponta para localhost (esperado em desenvolvimento).',
      ),
    )
  } else {
    results.push(check('app_base_url', 'APP_BASE_URL', 'ok', `Definida (${new URL(env.APP_BASE_URL).host}).`))
  }

  const frameAncestors = (env.BITRIX_EXTRA_FRAME_ANCESTORS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  results.push(
    frameAncestors.length > 0
      ? check('frame_ancestors', 'frame-ancestors (CSP)', 'ok', `${frameAncestors.length} origem(ns) extra configurada(s) além dos portais ativos no banco.`)
      : check(
          'frame_ancestors',
          'frame-ancestors (CSP)',
          'warning',
          'BITRIX_EXTRA_FRAME_ANCESTORS vazia — o app só poderá ser incorporado em iframe depois de existir um BitrixPortal ACTIVE (falha fechada, nunca aberta).',
        ),
  )

  // --- Configuração do Aplicativo Local ---
  const extraAdmins = (env.BITRIX_EXTRA_ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  results.push(
    check(
      'extra_admins',
      'BITRIX_EXTRA_ADMIN_USER_IDS',
      'ok',
      extraAdmins.length > 0 ? `${extraAdmins.length} entrada(s) configurada(s) (opcional).` : 'Vazia — só quem instalou o app é administrador (opcional).',
    ),
  )

  return results
}

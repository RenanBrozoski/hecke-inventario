import pino from 'pino'

// Lido diretamente de process.env (sem getEnv()) porque este módulo pode ser
// importado antes de qualquer .env estar configurado (ex.: durante o build) —
// aqui só precisamos de defaults razoáveis, não de validação estrita.
const nodeEnv = process.env.NODE_ENV ?? 'development'
const logLevel = process.env.LOG_LEVEL ?? 'info'

/**
 * O redact abaixo é defesa em profundidade, não a garantia principal — a
 * garantia real é NUNCA passar `answers`/`values` inteiros de uma Request
 * pro logger (as chaves são definidas pelo admin do formulário, ex.
 * `campo_cpf_colaborador`, então nenhuma lista de nomes fixos cobre isso).
 * Sempre logar só o que for necessário (ids, contadores, chaves de campo
 * isoladas), nunca o objeto de respostas inteiro. Os paths `*.answers`/
 * `*.values` aqui existem só para não deixar em branco caso alguém quebre
 * essa regra por engano.
 */
export const logger = pino({
  level: logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      '*.password',
      '*.token',
      '*.accessToken',
      '*.access_token',
      '*.refreshToken',
      '*.refresh_token',
      '*.AUTH_ID',
      '*.REFRESH_ID',
      '*.cpf',
      '*.cnpj',
      '*.answers',
      '*.values',
    ],
    censor: '[REDACTED]',
  },
  transport:
    nodeEnv !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
})

/**
 * Rate limiting básico em memória, por IP e por "bucket" (chave lógica do
 * endpoint) — suficiente para conter tentativas grosseiras de força bruta ou
 * abuso contra endpoints públicos (chamados sem sessão prévia, direto pelo
 * Bitrix24 ou por um navegador). Limitação conhecida: não é compartilhado
 * entre instâncias/regiões serverless; se o volume exigir, trocar por um
 * limitador distribuído (ex. Upstash) é um upgrade direto — a assinatura de
 * `isRateLimited` não precisaria mudar para quem chama.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export function isRateLimited(bucketKey: string, ip: string, windowMs: number, max: number): boolean {
  const key = `${bucketKey}:${ip}`
  const now = Date.now()
  const entry = buckets.get(key)
  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  entry.count += 1
  return entry.count > max
}

export function extractClientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

export const RATE_LIMIT_HEADERS = { 'Cache-Control': 'no-store' }

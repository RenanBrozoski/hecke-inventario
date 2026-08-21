/**
 * Lista de origens autorizadas a exibir o app em iframe. Nesta fase vem de
 * BITRIX_EXTRA_FRAME_ANCESTORS (CSV) — já estruturada como LISTA (não uma
 * única string/domínio) para suportar múltiplos portais mais adiante, sem
 * precisar mudar esta função, só o conteúdo da variável (ou, no futuro,
 * combinando com os domínios de BitrixPortal ativos no banco).
 *
 * Nunca retorna "*". Se nada estiver configurado, retorna lista vazia — o
 * navegador então bloqueia a incorporação por padrão (falha fechada, não aberta).
 */
export function getAllowedFrameAncestors(): string[] {
  const raw = process.env.BITRIX_EXTRA_FRAME_ANCESTORS ?? ''
  return raw
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => Boolean(origin))
}

/** Normaliza para "https://host" — rejeita qualquer coisa que não seja HTTPS. */
export function normalizeOrigin(rawOrigin: string): string | null {
  const trimmed = rawOrigin.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'https:') return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

export function buildFrameAncestorsCsp(): string {
  const origins = getAllowedFrameAncestors()
  if (origins.length === 0) {
    return "frame-ancestors 'none'"
  }
  return `frame-ancestors ${origins.join(' ')}`
}

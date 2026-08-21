/**
 * Resolve o domínio do portal a partir do payload enviado pelo Bitrix24.
 *
 * O campo `DOMAIN` NÃO é garantido: neste portal (hecke.bitrix24.com.br,
 * conferido em 2026-08-21) a instalação de Aplicativo Local chega apenas com
 * `APPLICATION_SCOPE, APPLICATION_TOKEN, AUTH_EXPIRES, AUTH_ID, PLACEMENT,
 * PLACEMENT_OPTIONS, REFRESH_ID, SERVER_ENDPOINT, member_id, status` — sem
 * `DOMAIN`. Exigir `DOMAIN` fazia a instalação falhar com "dados incompletos".
 *
 * `SERVER_ENDPOINT` vem como a URL REST do portal (ex.:
 * "https://hecke.bitrix24.com.br/rest/"), então o host dela é o domínio.
 *
 * Nível de confiança: o mesmo de `DOMAIN` — é dado do request e serve apenas
 * para saber CONTRA QUEM validar o AUTH_ID. Quem prova a identidade é a
 * resposta autenticada de `user.current` no próprio portal (ver install/route).
 * Aceita só https, para não permitir downgrade do endpoint de validação.
 */
export function resolvePortalDomain(
  rawDomain: string | undefined,
  rawServerEndpoint: string | undefined,
): string | null {
  const direct = normalizeHost(rawDomain)
  if (direct) return direct
  return hostFromUrl(rawServerEndpoint)
}

/** "hecke.bitrix24.com.br" ou "https://hecke.bitrix24.com.br" -> host puro. */
function normalizeHost(raw: string | undefined): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  if (trimmed.includes('://')) return hostFromUrl(trimmed)
  // O Bitrix24 manda DOMAIN sem esquema; rejeitamos qualquer coisa com caminho,
  // porta estranha ou espaço — o valor alimenta a URL de validação REST.
  return /^[a-z0-9.-]+$/i.test(trimmed) ? trimmed.toLowerCase() : null
}

function hostFromUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:') return null
    return url.host.toLowerCase()
  } catch {
    return null
  }
}

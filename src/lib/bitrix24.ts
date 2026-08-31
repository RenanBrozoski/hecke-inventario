export type BitrixUser = {
  ID: string
  NAME: string
  LAST_NAME: string
  EMAIL: string
  ACTIVE: boolean
  PERSONAL_PHOTO?: string
}

const WEBHOOK = process.env.BITRIX24_WEBHOOK_URL?.replace(/\/$/, '')

async function post<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!WEBHOOK) throw new Error('BITRIX24_WEBHOOK_URL não configurado')
  const res = await fetch(`${WEBHOOK}/${method}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Bitrix24 ${method}: HTTP ${res.status}`)
  const json = (await res.json()) as { result: T; error?: string; error_description?: string }
  if (json.error) throw new Error(`Bitrix24: ${json.error} — ${json.error_description ?? ''}`)
  return json.result
}

export async function searchBitrixUsers(query: string): Promise<BitrixUser[]> {
  // user.get com FILTER[FIND] faz busca parcial por nome, sobrenome e e-mail
  const result = await post<BitrixUser[]>('user.get', {
    FILTER: { FIND: query, ACTIVE: true },
  })
  if (!Array.isArray(result)) return []
  return result.slice(0, 20) // limita para não sobrecarregar o dropdown
}

export async function getBitrixUser(id: string): Promise<BitrixUser | null> {
  const result = await post<BitrixUser[]>('user.get', { FILTER: { ID: id } })
  return Array.isArray(result) && result.length > 0 ? (result[0] ?? null) : null
}

export async function getAllActiveBitrixUsers(): Promise<BitrixUser[]> {
  const result = await post<BitrixUser[]>('user.get', { FILTER: { ACTIVE: true } })
  if (!Array.isArray(result)) return []
  return result.slice(0, 200)
}

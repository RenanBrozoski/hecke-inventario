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

async function paginatedGet<T>(method: string, params: Record<string, unknown> = {}): Promise<T[]> {
  if (!WEBHOOK) throw new Error('BITRIX24_WEBHOOK_URL não configurado')
  const all: T[] = []
  let start = 0
  while (true) {
    const res = await fetch(`${WEBHOOK}/${method}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, start }),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Bitrix24 ${method}: HTTP ${res.status}`)
    const json = (await res.json()) as {
      result: T[]
      next?: number
      error?: string
      error_description?: string
    }
    if (json.error) throw new Error(`Bitrix24: ${json.error} — ${json.error_description ?? ''}`)
    const items = Array.isArray(json.result) ? json.result : []
    all.push(...items)
    if (json.next == null || items.length === 0) break
    start = json.next
  }
  return all
}

export async function searchBitrixUsers(query: string): Promise<BitrixUser[]> {
  // FIND é parâmetro top-level em user.get; dentro de FILTER é ignorado
  const result = await post<BitrixUser[]>('user.get', {
    FIND: query,
    FILTER: { ACTIVE: true },
  })
  if (!Array.isArray(result)) return []
  return result.slice(0, 20)
}

export async function getBitrixUser(id: string): Promise<BitrixUser | null> {
  const result = await post<BitrixUser[]>('user.get', { FILTER: { ID: id } })
  return Array.isArray(result) && result.length > 0 ? (result[0] ?? null) : null
}

export async function getAllActiveBitrixUsers(): Promise<BitrixUser[]> {
  return paginatedGet<BitrixUser>('user.get', { FILTER: { ACTIVE: true } })
}

export async function getBitrixUsersByIds(ids: string[]): Promise<BitrixUser[]> {
  if (ids.length === 0) return []
  const result = await post<BitrixUser[]>('user.get', { FILTER: { ACTIVE: true, ID: ids } })
  return Array.isArray(result) ? result : []
}

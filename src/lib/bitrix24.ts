export type BitrixUser = {
  ID: string
  NAME: string
  LAST_NAME: string
  EMAIL: string
  ACTIVE: boolean
  PERSONAL_PHOTO?: string
}

const WEBHOOK = process.env.BITRIX24_WEBHOOK_URL?.replace(/\/$/, '')

async function call<T>(method: string, params: Record<string, string> = {}): Promise<T> {
  if (!WEBHOOK) throw new Error('BITRIX24_WEBHOOK_URL não configurado')
  const url = new URL(`${WEBHOOK}/${method}.json`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Bitrix24 ${method}: HTTP ${res.status}`)
  const json = (await res.json()) as { result: T; error?: string }
  if (json.error) throw new Error(`Bitrix24: ${json.error}`)
  return json.result
}

export async function searchBitrixUsers(query: string): Promise<BitrixUser[]> {
  const result = await call<BitrixUser[]>('user.search', { FIND: query })
  if (!Array.isArray(result)) return []
  return result.filter((u) => u.ACTIVE !== false)
}

export async function getBitrixUser(id: string): Promise<BitrixUser | null> {
  const result = await call<BitrixUser[]>('user.get', { ID: id })
  return Array.isArray(result) && result.length > 0 ? (result[0] ?? null) : null
}

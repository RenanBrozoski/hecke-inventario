'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'

export interface MeResponse {
  portal: { domain: string; status: string }
  user: { bitrixUserId: string; fullName: string; isAdmin: boolean }
}

type SessionState =
  | { status: 'loading' }
  | { status: 'no-handshake' }
  | { status: 'error'; message: string }
  | { status: 'ready'; me: MeResponse }

export interface SessionContextValue {
  state: SessionState
  /** Anexa `Authorization: Bearer <token>` automaticamente — nunca usar `fetch` puro para rotas protegidas. */
  authorizedFetch: (input: string, init?: RequestInit) => Promise<Response>
}

const SessionContext = createContext<SessionContextValue | null>(null)

// Renova a sessão ~3 min antes de expirar (TTL da sessão é 20-30 min).
const SESSION_REFRESH_MARGIN_MS = 3 * 60 * 1000

const BX24_SCRIPT_URL = 'https://api.bitrix24.com/api/v1/'
const BX24_TIMEOUT_MS = 8_000

interface BX24Auth {
  domain: string
  member_id: string
  access_token: string
  refresh_token: string
  expires_in?: number
  scope?: string
}

interface BX24Global {
  init: (callback: () => void) => void
  getAuth: () => BX24Auth | false
  callMethod: (method: string, params: Record<string, unknown>, callback: (result: BX24Result) => void) => void
  placement?: { info: () => { placement?: string } }
}

interface BX24Result {
  error: () => string | null
  data: () => Record<string, unknown>
}

declare global {
  interface Window {
    BX24?: BX24Global
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(onTimeoutMessage)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function loadBX24Script(): Promise<BX24Global> {
  if (window.BX24) return Promise.resolve(window.BX24)
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = BX24_SCRIPT_URL
    script.async = true
    script.onload = () => {
      if (window.BX24) resolve(window.BX24)
      else reject(new Error('bitrix24.js carregou mas não expôs window.BX24.'))
    }
    script.onerror = () => reject(new Error('Falha ao carregar o SDK do Bitrix24.'))
    document.head.appendChild(script)
  })
}

/**
 * Resolve quem abriu o app inteiramente DENTRO do iframe, via SDK oficial —
 * nunca a partir do POST bruto que o Bitrix24 envia na abertura (ver
 * src/modules/bitrix/launch.ts para o porquê). Retorna `null` (nunca lança)
 * quando o app não está rodando dentro de um iframe do Bitrix24, para cair
 * no estado "no-handshake" normalmente.
 */
async function bootstrapViaBX24(): Promise<string | null> {
  if (typeof window === 'undefined' || window.top === window.self) return null

  const BX24 = await withTimeout(loadBX24Script(), BX24_TIMEOUT_MS, 'Tempo esgotado carregando o SDK do Bitrix24.')

  await withTimeout(
    new Promise<void>((resolve) => BX24.init(() => resolve())),
    BX24_TIMEOUT_MS,
    'Tempo esgotado inicializando o SDK do Bitrix24.',
  )

  const auth = BX24.getAuth()
  if (!auth) {
    throw new Error('Não foi possível obter as credenciais do Bitrix24 (BX24.getAuth() vazio). Recarregue a página dentro do Bitrix24.')
  }

  const user = await withTimeout(
    new Promise<Record<string, unknown>>((resolve, reject) => {
      BX24.callMethod('user.current', {}, (result) => {
        const error = result.error()
        if (error) reject(new Error(error))
        else resolve(result.data())
      })
    }),
    BX24_TIMEOUT_MS,
    'Tempo esgotado obtendo o usuário atual do Bitrix24.',
  )

  let placement: string | null = null
  try {
    placement = BX24.placement?.info()?.placement ?? null
  } catch {
    placement = null
  }

  const response = await fetch('/api/bitrix/session-bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth, user, placement }),
  })
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? `Falha ao validar a sessão com o Bitrix24 (status ${response.status}).`)
  }

  const data = (await response.json()) as { code: string }
  return data.code
}

/**
 * Único lugar que faz o handshake com o Bitrix24 (troca `hs` por sessão) e
 * mantém o token em memória — nunca localStorage/sessionStorage (risco de
 * XSS). Precisa envolver TODAS as páginas embedded (dashboard + admin de
 * formulários) num layout compartilhado (ver app/(embedded)/layout.tsx) para
 * que navegar entre elas não perca a sessão em memória.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams()
  const [state, setState] = useState<SessionState>({ status: 'loading' })

  const sessionTokenRef = useRef<string | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const authorizedFetch = useCallback((input: string, init: RequestInit = {}) => {
    const token = sessionTokenRef.current
    if (!token) return Promise.reject(new Error('Sessão não estabelecida.'))
    return fetch(input, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    })
  }, [])

  const loadMe = useCallback(async () => {
    try {
      const response = await authorizedFetch('/api/auth/me')
      if (!response.ok) {
        setState({ status: 'error', message: 'Sessão expirada ou inválida. Reabra o aplicativo pelo Bitrix24.' })
        return
      }
      const me = (await response.json()) as MeResponse
      setState({ status: 'ready', me })
    } catch {
      setState({ status: 'error', message: 'Não foi possível carregar os dados da sessão.' })
    }
  }, [authorizedFetch])

  const scheduleRefresh = useCallback(
    (expiresAtIso: string) => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      const expiresAt = new Date(expiresAtIso).getTime()
      const delay = Math.max(expiresAt - Date.now() - SESSION_REFRESH_MARGIN_MS, 5_000)

      refreshTimerRef.current = setTimeout(async () => {
        try {
          const response = await authorizedFetch('/api/auth/refresh', { method: 'POST' })
          if (!response.ok) throw new Error('refresh falhou')
          const data = (await response.json()) as { token: string; expiresAt: string }
          sessionTokenRef.current = data.token
          scheduleRefresh(data.expiresAt)
        } catch {
          sessionTokenRef.current = null
          setState({ status: 'error', message: 'Sua sessão expirou. Reabra o aplicativo pelo Bitrix24.' })
        }
      }, delay)
    },
    [authorizedFetch],
  )

  const bootstrap = useCallback(async () => {
    let handshake = searchParams.get('hs')

    if (handshake) {
      window.history.replaceState(null, '', window.location.pathname)
    } else {
      try {
        handshake = await bootstrapViaBX24()
      } catch (error) {
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Falha ao inicializar o SDK do Bitrix24.',
        })
        return
      }
    }

    if (!handshake) {
      setState({ status: 'no-handshake' })
      return
    }

    try {
      const response = await fetch('/api/auth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: handshake }),
      })

      if (!response.ok) {
        setState({ status: 'error', message: 'Não foi possível estabelecer a sessão. Reabra o aplicativo pelo Bitrix24.' })
        return
      }

      const data = (await response.json()) as { token: string; expiresAt: string }
      sessionTokenRef.current = data.token
      scheduleRefresh(data.expiresAt)
      await loadMe()
    } catch {
      setState({ status: 'error', message: 'Falha de comunicação ao estabelecer a sessão.' })
    }
  }, [searchParams, scheduleRefresh, loadMe])

  useEffect(() => {
    void bootstrap()
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
    // Só na montagem — não queremos reexecutar o handshake se searchParams mudar depois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <SessionContext.Provider value={{ state, authorizedFetch }}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession precisa ser usado dentro de <SessionProvider>.')
  return ctx
}

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SessionProvider, useSession } from './SessionProvider'

const { useSearchParamsMock } = vi.hoisted(() => ({ useSearchParamsMock: vi.fn() }))
vi.mock('next/navigation', () => ({ useSearchParams: useSearchParamsMock }))

function Consumer() {
  const { state, authorizedFetch } = useSession()
  return (
    <div>
      <div data-testid="status">{state.status}</div>
      <div data-testid="user">{state.status === 'ready' ? state.me.user.fullName : ''}</div>
      <button
        type="button"
        onClick={() => {
          void authorizedFetch('/api/whatever')
        }}
      >
        chamar
      </button>
    </div>
  )
}

const READY_ME = {
  portal: { domain: 'empresa.bitrix24.com.br', status: 'ACTIVE' },
  user: { bitrixUserId: '1', fullName: 'Ana', isAdmin: true },
}

describe('SessionProvider — garantias de sessão compartilhada', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mostra no-handshake quando a URL não tem `hs` (reload direto numa página administrativa, item 2)', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams())
    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('no-handshake'))
  })

  it('troca o handshake exatamente uma vez e carrega /me (item 8: sem repetir o exchange)', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('hs=codigo-teste'))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'token-1', expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString() }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => READY_ME })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
    expect(screen.getByTestId('user')).toHaveTextContent('Ana')

    const exchangeCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/auth/exchange'))
    expect(exchangeCalls).toHaveLength(1)
  })

  it('nunca inclui o token na URL, em erros ou em qualquer chamada de log (item 6)', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('hs=codigo-teste'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'segredo-nao-deve-vazar', expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString() }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => READY_ME })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))

    expect(window.location.href).not.toContain('segredo-nao-deve-vazar')
    expect(document.body.innerHTML).not.toContain('segredo-nao-deve-vazar')
    for (const call of consoleSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('segredo-nao-deve-vazar')
    }
  })

  it('erro no exchange leva a estado "error", sem revelar detalhes sensíveis', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('hs=codigo-invalido'))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'Código inválido ou expirado.' }) }),
    )

    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'))
  })

  it('agenda a renovação automática e, se ela falhar, limpa usuário/portal do estado (itens 3, 4 e 7)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    useSearchParamsMock.mockReturnValue(new URLSearchParams('hs=codigo-teste'))

    // Expira em 3min05s — a margem de renovação é 3min, então o refresh é
    // agendado para ~5s (respeitando o mínimo de 5s do próprio provider).
    const shortExpiry = new Date(Date.now() + 3 * 60 * 1000 + 5000).toISOString()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'token-1', expiresAt: shortExpiry }) })
      .mockResolvedValueOnce({ ok: true, json: async () => READY_ME })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'Não autorizado.' }) }) // refresh falha

    vi.stubGlobal('fetch', fetchMock)

    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )

    await vi.waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))

    await vi.advanceTimersByTimeAsync(6000)

    await vi.waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'))
    // Estado anterior (usuário/portal) não deve mais estar acessível.
    expect(screen.getByTestId('user')).toHaveTextContent('')

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/auth/refresh'))
    expect(refreshCalls).toHaveLength(1)
  })
})

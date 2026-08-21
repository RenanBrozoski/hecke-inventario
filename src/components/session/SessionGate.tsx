'use client'

import type { ReactNode } from 'react'
import { AppShell } from '@/src/components/layout/AppShell'
import { type MeResponse, useSession } from './SessionProvider'

interface SessionGateProps {
  children: (me: MeResponse) => ReactNode
  /** Se true, mostra uma mensagem de acesso negado quando `me.user.isAdmin` for false. */
  requireAdmin?: boolean
}

/** Envolve o conteúdo de uma página embedded, mostrando carregamento/erro/
 * sem-handshake antes de existir uma sessão pronta — nenhuma página deve
 * reimplementar esses três estados por conta própria. Quando a sessão está
 * pronta, monta o AppShell (navegação persistente) em volta do conteúdo. */
export function SessionGate({ children, requireAdmin }: SessionGateProps) {
  const { state } = useSession()

  if (state.status === 'loading') {
    return (
      <main style={{ padding: '2rem', color: 'var(--color-text-muted)' }}>Carregando…</main>
    )
  }

  if (state.status === 'no-handshake') {
    return (
      <main style={{ padding: '2rem', maxWidth: 480 }}>
        <h1>Portal de Solicitações</h1>
        <p>Este aplicativo precisa ser aberto de dentro do Bitrix24.</p>
      </main>
    )
  }

  if (state.status === 'error') {
    return (
      <main style={{ padding: '2rem', maxWidth: 480 }}>
        <h1>Portal de Solicitações</h1>
        <p className="alert alert-error">{state.message}</p>
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          Tentar novamente
        </button>
      </main>
    )
  }

  if (requireAdmin && !state.me.user.isAdmin) {
    return (
      <main style={{ padding: '2rem', maxWidth: 480 }}>
        <h1>Acesso restrito</h1>
        <p>Somente administradores podem acessar esta área.</p>
      </main>
    )
  }

  return <AppShell me={state.me}>{children(state.me)}</AppShell>
}

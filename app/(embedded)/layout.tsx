import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { SessionProvider } from '@/src/components/session/SessionProvider'

/**
 * Layout compartilhado por TODAS as páginas embedded (`/bitrix/app` e
 * `/admin/applications/**`) — o SessionProvider é montado UMA vez aqui. Navegar
 * entre essas páginas é navegação client-side dentro do mesmo layout, então a
 * sessão em memória sobrevive; se cada página montasse seu próprio provider,
 * a sessão se perderia a cada troca de página.
 */
export default function EmbeddedLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<main style={{ padding: '2rem' }}>Carregando…</main>}>
      <SessionProvider>{children}</SessionProvider>
    </Suspense>
  )
}

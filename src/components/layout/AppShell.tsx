import type { ReactNode } from 'react'
import type { MeResponse } from '@/src/components/session/SessionProvider'

/** Moldura mínima para as páginas embedded.
 * A navegação do produto mora inteiramente no módulo de inventário; manter
 * uma segunda barra aqui duplicava links e competia com a navegação do Bitrix. */
export function AppShell({ children }: { me: MeResponse; children: ReactNode }) {
  return (
    <div className="app-shell app-shell--compact">
      <main className="app-shell__main">{children}</main>
    </div>
  )
}

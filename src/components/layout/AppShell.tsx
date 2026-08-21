import Link from 'next/link'
import type { ReactNode } from 'react'
import type { MeResponse } from '@/src/components/session/SessionProvider'

/** Navegação persistente para todas as páginas embedded — montada uma única
 * vez em SessionGate assim que a sessão está pronta, para nenhuma página
 * precisar reimplementar links de volta.
 *
 * As seções internas do inventário (Equipamentos, Colaboradores, Termos,
 * Relatórios, Configuração) ficam na navegação do próprio módulo, em
 * InventoryGate — aqui só entram os destinos de nível de aplicativo. */
export function AppShell({ me, children }: { me: MeResponse; children: ReactNode }) {
  return (
    <div className="app-shell">
      <nav className="app-shell__nav">
        <div className="app-shell__nav-title">Inventário de TI</div>

        <div className="app-shell__nav-group">
          <Link href="/bitrix/app/view">Início</Link>
          <Link href="/inventory">Inventário</Link>
        </div>

        {me.user.isAdmin && (
          <div className="app-shell__nav-group">
            <div className="app-shell__nav-label">Administração</div>
            <Link href="/inventory/settings">Configuração do inventário</Link>
          </div>
        )}
      </nav>
      <main className="app-shell__main">{children}</main>
    </div>
  )
}

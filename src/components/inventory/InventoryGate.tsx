'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { readApiError } from './format'
import type { InventoryContextApiResponse, InventoryContextResponse } from './types'
import styles from './inventory.module.css'

interface InventoryGateProps {
  children: (context: InventoryContextResponse) => ReactNode
}

interface NavigationItem { href: string; label: string; icon: string; adminOnly?: boolean; exact?: boolean }
interface NavigationSection { label: string; items: NavigationItem[] }

const NAV_SECTIONS: NavigationSection[] = [
  {
    label: 'Visão geral',
    items: [
      { href: '/inventory', label: 'Painel', icon: '◈', exact: true },
      { href: '/inventory/equipment', label: 'Equipamentos', icon: '▣' },
      { href: '/inventory/people', label: 'Colaboradores', icon: '◎' },
      { href: '/inventory/corporate-lines', label: 'Linhas corporativas', icon: '⌁' },
    ],
  },
  {
    label: 'Operações',
    items: [
      { href: '/inventory/extensions', label: 'Ramais', icon: '⌕' },
      { href: '/inventory/receivings', label: 'Recebimentos', icon: '↓' },
      { href: '/inventory/terms', label: 'Termos', icon: '≡' },
      { href: '/inventory/reports', label: 'Relatórios', icon: '◫' },
    ],
  },
  {
    label: 'Administração',
    items: [
      { href: '/inventory/custom', label: 'Personalizados', icon: '＋' },
      { href: '/inventory/audit', label: 'Auditoria', icon: '◑', adminOnly: true },
      { href: '/inventory/imports', label: 'Importar planilha', icon: '⇧', adminOnly: true },
      { href: '/inventory/settings', label: 'Configurações', icon: '⚙', adminOnly: true },
    ],
  },
]

export function InventoryGate({ children }: InventoryGateProps) {
  const { authorizedFetch } = useSession()
  const pathname = usePathname()
  const [context, setContext] = useState<InventoryContextResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await authorizedFetch('/api/inventory/context')
      if (!response.ok)
        throw new Error(
          await readApiError(response, 'Não foi possível validar o acesso ao inventário.'),
        )
      const body = (await response.json()) as InventoryContextApiResponse
      const role = body.context.role
      setContext({
        ...body.context,
        canEdit: role === 'ADMIN' || role === 'OPERATOR',
        canAdmin: role === 'ADMIN',
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao validar o acesso ao inventário.')
    }
  }, [authorizedFetch])

  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <div className={styles.errorState}>
        <h1>Inventário</h1>
        <p className="alert alert-error">{error}</p>
        <button type="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </div>
    )
  }

  if (!context) return <p className={styles.loading}>Carregando inventário…</p>

  return (
    <div className={styles.module}>
      <aside className={styles.inventorySidebar}>
        <div className={styles.inventoryBrand}>
          <span className={styles.brandMark}>IT</span>
          <div><strong>Inventário</strong><small>Ativos e operações</small></div>
        </div>
        <nav className={styles.sidebarNav} aria-label="Seções do inventário">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => !item.adminOnly || context.canAdmin)
            if (!items.length) return null
            return <section key={section.label} className={styles.sidebarSection}>
              <span>{section.label}</span>
              {items.map((item) => {
                const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
                return <Link key={item.href} href={item.href} className={active ? styles.sidebarActive : ''}>
                  <i aria-hidden="true">{item.icon}</i>{item.label}
                </Link>
              })}
            </section>
          })}
        </nav>
        <div className={styles.sidebarFooter}>
          <span className={styles.role} title="Papel de acesso ao inventário">{context.role === 'ADMIN' ? 'Administrador' : context.role === 'OPERATOR' ? 'Operador' : 'Consulta'}</span>
          <small>Acesso controlado</small>
        </div>
      </aside>
      <main className={styles.inventoryContent}>{children(context)}</main>
    </div>
  )
}

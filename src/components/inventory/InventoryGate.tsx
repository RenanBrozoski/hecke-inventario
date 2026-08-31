'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { readApiError } from './format'
import type { InventoryContextApiResponse, InventoryContextResponse } from './types'
import styles from './inventory.module.css'

export const InventoryContext = createContext<InventoryContextResponse | null>(null)

export function useInventoryContext(): InventoryContextResponse {
  const ctx = use(InventoryContext)
  if (!ctx) throw new Error('useInventoryContext must be used inside InventoryGate')
  return ctx
}

interface InventoryGateProps {
  children: ReactNode
}

type IconFC = () => React.JSX.Element

function IconPanel() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/><rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/><rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/><rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/></svg> }
function IconEquipment() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1" y="2" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M5 14h6M8 11v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> }
function IconPeople() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M2 14c0-3.314 2.686-5 6-5s6 1.686 6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> }
function IconPhone() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 3h2.5l1 2.5-1.5 1a8 8 0 0 0 4.5 4.5l1-1.5 2.5 1V13a1 1 0 0 1-1 1C5 14 2 9 2 4a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg> }
function IconExtension() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 3h2.5l1 2.5-1.5 1a8 8 0 0 0 4.5 4.5l1-1.5 2.5 1V13a1 1 0 0 1-1 1C5 14 2 9 2 4a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M11 2l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function IconReceiving() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 11v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> }
function IconTerms() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="1" width="10" height="13" rx="1" stroke="currentColor" strokeWidth="1.5"/><path d="M5 5h5M5 8h5M5 11h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M12 4l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function IconReports() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 14h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><rect x="3" y="9" width="2" height="5" fill="currentColor" rx="0.5"/><rect x="7" y="5" width="2" height="9" fill="currentColor" rx="0.5"/><rect x="11" y="2" width="2" height="12" fill="currentColor" rx="0.5"/></svg> }
function IconCustom() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> }
function IconAgents() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.5L13.5 4.5v7L8 14.5 2.5 11.5v-7L8 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg> }
function IconAudit() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> }
function IconImport() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 10V2M5 5l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 11v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> }
function IconSettings() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> }

interface NavigationItem { href: string; label: string; icon: IconFC; adminOnly?: boolean; exact?: boolean }
interface NavigationSection { label: string; items: NavigationItem[] }

const NAV_SECTIONS: NavigationSection[] = [
  {
    label: 'Visão geral',
    items: [
      { href: '/inventory', label: 'Painel', icon: IconPanel, exact: true },
      { href: '/inventory/equipment', label: 'Equipamentos', icon: IconEquipment },
      { href: '/inventory/people', label: 'Colaboradores', icon: IconPeople },
      { href: '/inventory/corporate-lines', label: 'Linhas corporativas', icon: IconPhone },
    ],
  },
  {
    label: 'Operações',
    items: [
      { href: '/inventory/extensions', label: 'Ramais', icon: IconExtension },
      { href: '/inventory/receivings', label: 'Recebimentos', icon: IconReceiving },
      { href: '/inventory/terms', label: 'Termos', icon: IconTerms },
      { href: '/inventory/reports', label: 'Relatórios', icon: IconReports },
    ],
  },
  {
    label: 'Administração',
    items: [
      { href: '/inventory/custom', label: 'Personalizados', icon: IconCustom },
      { href: '/inventory/agents', label: 'Agentes', icon: IconAgents, adminOnly: true },
      { href: '/inventory/audit', label: 'Auditoria', icon: IconAudit, adminOnly: true },
      { href: '/inventory/imports', label: 'Importar planilha', icon: IconImport, adminOnly: true },
      { href: '/inventory/settings', label: 'Configurações', icon: IconSettings, adminOnly: true },
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
          <span className={styles.brandMark} aria-hidden="true">H·I</span>
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
                  <item.icon />{item.label}
                </Link>
              })}
            </section>
          })}
        </nav>
        <div className={styles.sidebarFooter}>
          <span className={styles.role} title="Papel de acesso ao inventário">{context.role === 'ADMIN' ? 'Administrador' : context.role === 'OPERATOR' ? 'Suporte' : 'Consulta'}</span>
          <small>Acesso controlado</small>
        </div>
      </aside>
      <main className={styles.inventoryContent}>
        <InventoryContext value={context}>{children}</InventoryContext>
      </main>
    </div>
  )
}

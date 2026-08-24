'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { readApiError } from './format'
import type { InventoryContextApiResponse, InventoryContextResponse } from './types'
import styles from './inventory.module.css'

interface InventoryGateProps {
  children: (context: InventoryContextResponse) => ReactNode
}

const NAV_ITEMS = [
  { href: '/inventory', label: 'Visão geral' },
  { href: '/inventory/equipment', label: 'Equipamentos' },
  { href: '/inventory/people', label: 'Colaboradores' },
  { href: '/inventory/corporate-lines', label: 'Linhas corporativas' },
  { href: '/inventory/extensions', label: 'Ramais' },
  { href: '/inventory/receivings', label: 'Recebimentos' },
  { href: '/inventory/terms', label: 'Termos' },
  { href: '/inventory/reports', label: 'Relatórios' },
  { href: '/inventory/custom', label: 'Personalizados' },
  { href: '/inventory/imports', label: 'Importar planilha', adminOnly: true },
]

export function InventoryGate({ children }: InventoryGateProps) {
  const { authorizedFetch } = useSession()
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
      <div className={styles.moduleBar}>
        <nav className={styles.moduleNav} aria-label="Seções do inventário">
          {NAV_ITEMS.filter((item) => !item.adminOnly || context.canAdmin).map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
          {context.canAdmin && <Link href="/inventory/settings">Configuração</Link>}
        </nav>
        <span className={styles.role} title="Papel de acesso ao inventário">
          {context.role === 'ADMIN'
            ? 'Administrador'
            : context.role === 'OPERATOR'
              ? 'Operador'
              : 'Consulta'}
        </span>
      </div>
      {children(context)}
    </div>
  )
}

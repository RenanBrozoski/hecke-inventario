'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { equipmentLabel, formatDate, formatDateTime, readApiError } from './format'
import { InventoryGate } from './InventoryGate'
import type { InventoryLookupsResponse, InventoryMovement } from './types'
import styles from './inventory.module.css'

interface PageEnvelope<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface ExpirationItem {
  id: string
  label: string
  detail: string | null
  dueDate: string
  status: 'EXPIRED' | 'UPCOMING'
  href: string
}

interface ExpirationResponse extends PageEnvelope<ExpirationItem> {
  counts: { expired: number; upcoming: number }
}

interface AuditItem {
  id: string
  action: string
  entityType: string
  entityId: string
  bitrixUserId: string
  userName: string | null
  createdAt: string
}

export function InventoryReportsPage() {
  return <InventoryGate><ReportsContent /></InventoryGate>
}

function ReportsContent() {
  const { authorizedFetch } = useSession()
  const [expirations, setExpirations] = useState<ExpirationResponse | null>(null)
  const [movements, setMovements] = useState<PageEnvelope<InventoryMovement> | null>(null)
  const [audit, setAudit] = useState<PageEnvelope<AuditItem> | null>(null)
  const [lookups, setLookups] = useState<InventoryLookupsResponse | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const responses = await Promise.all([
        authorizedFetch('/api/inventory/reports/expirations?pageSize=100&windowDays=30'),
        authorizedFetch('/api/inventory/reports/movements?pageSize=100'),
        authorizedFetch('/api/inventory/reports/audit?pageSize=100'),
        authorizedFetch('/api/inventory/lookups'),
      ])
      const failed = responses.find((response) => !response.ok)
      if (failed)
        throw new Error(await readApiError(failed, 'Não foi possível carregar os relatórios.'))
      const [expirationBody, movementBody, auditBody, lookupBody] = await Promise.all(
        responses.map((response) => response.json()),
      )
      setExpirations(expirationBody as ExpirationResponse)
      setMovements(movementBody as PageEnvelope<InventoryMovement>)
      setAudit(auditBody as PageEnvelope<AuditItem>)
      setLookups(lookupBody as InventoryLookupsResponse)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar os relatórios.')
    } finally {
      setLoading(false)
    }
  }, [authorizedFetch])

  useEffect(() => {
    void load()
  }, [load])

  async function downloadEquipmentCsv() {
    setExporting(true)
    setError(null)
    try {
      const suffix = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : ''
      const response = await authorizedFetch(`/api/inventory/reports/equipment.csv${suffix}`)
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível exportar os equipamentos.'))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = categoryId ? 'inventario-categoria.csv' : 'inventario.csv'
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao exportar os equipamentos.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <h1>Relatórios</h1>
          <p className={styles.subtitle}>Vencimentos, movimentações, auditoria e exportação.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          Atualizar
        </button>
      </header>

      {error && <p className="alert alert-error">{error}</p>}
      {loading && <p className={styles.loading}>Carregando relatórios…</p>}

      {!loading && (
        <>
          <section className={styles.card} style={{ marginBottom: '1rem' }}>
            <h2>Exportar equipamentos</h2>
            <div className={styles.actions}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Categoria</span>
                <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  <option value="">Todas (especificações em JSON)</option>
                  {lookups?.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="primary"
                onClick={() => void downloadEquipmentCsv()}
                disabled={exporting}
              >
                {exporting ? 'Gerando…' : 'Baixar CSV para Excel'}
              </button>
            </div>
            <p className={styles.notice}>
              A exportação por categoria cria colunas para os campos marcados como visíveis na
              lista. Campos de senha nunca são exportados.
            </p>
          </section>

          <section className={styles.card} style={{ marginBottom: '1rem' }}>
            <div className={styles.pageHeader} style={{ marginBottom: '0.75rem' }}>
              <div>
                <h2>Vencimentos</h2>
                <p className={styles.notice}>
                  {expirations?.counts.expired ?? 0} vencidos · {expirations?.counts.upcoming ?? 0}{' '}
                  nos próximos 30 dias
                </p>
              </div>
            </div>
            {!expirations?.items.length ? (
              <p className={styles.empty}>Nenhum vencimento no período.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Vencimento</th>
                      <th>Registro</th>
                      <th>Origem</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expirations.items.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDate(item.dueDate)}</td>
                        <td>
                          <Link href={item.href}>{item.label}</Link>
                        </td>
                        <td>{item.detail ?? '—'}</td>
                        <td>
                          <span
                            className={`${styles.badge} ${item.status === 'EXPIRED' ? styles.danger : styles.warning}`}
                          >
                            {item.status === 'EXPIRED' ? 'Vencido' : 'Próximo'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={styles.card} style={{ marginBottom: '1rem' }}>
            <h2>Movimentações recentes</h2>
            {!movements?.items.length ? (
              <p className={styles.empty}>Nenhuma movimentação encontrada.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Equipamento</th>
                      <th>Origem</th>
                      <th>Destino</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.items.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDate(item.movedAt)}</td>
                        <td>
                          {item.equipment ? (
                            <Link href={`/inventory/equipment/${item.equipment.id}`}>
                              {equipmentLabel(item.equipment)}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{item.fromPersonName || 'Estoque / sem responsável'}</td>
                        <td>{item.toPersonName || 'Estoque / sem responsável'}</td>
                        <td>{item.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(movements?.total ?? 0) > (movements?.items.length ?? 0) && (
              <p className={styles.notice}>
                Exibindo as 100 movimentações mais recentes de {movements?.total}.
              </p>
            )}
          </section>

          <section className={styles.card}>
            <h2>Auditoria recente</h2>
            {!audit?.items.length ? (
              <p className={styles.empty}>Nenhum evento de auditoria encontrado.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Ação</th>
                      <th>Entidade</th>
                      <th>Responsável</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.items.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDateTime(item.createdAt)}</td>
                        <td>{item.action.replace(/^inventory_/, '').replaceAll('_', ' ')}</td>
                        <td>
                          {item.entityType} · {item.entityId}
                        </td>
                        <td>{item.userName || `Bitrix #${item.bitrixUserId}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(audit?.total ?? 0) > (audit?.items.length ?? 0) && (
              <p className={styles.notice}>
                Exibindo os 100 eventos mais recentes de {audit?.total}.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}

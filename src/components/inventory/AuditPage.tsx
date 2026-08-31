'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { formatDateTime, readApiError } from './format'
import { InventoryGate, useInventoryContext } from './InventoryGate'
import styles from './inventory.module.css'

interface AuditItem {
  id: string
  action: string
  entityType: string
  entityId: string
  bitrixUserId: string
  userName: string | null
  createdAt: string
  metadata: Record<string, unknown> | null
}

interface AuditResponse {
  items: AuditItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const ACTION_LABELS: Record<string, string> = {
  inventory_equipment_created: 'Equipamento criado',
  inventory_equipment_updated: 'Equipamento editado',
  inventory_equipment_transferred: 'Equipamento transferido',
  inventory_equipment_archived: 'Equipamento arquivado',
  inventory_equipment_restored: 'Equipamento restaurado',
  inventory_equipment_deleted: 'Equipamento excluído',
  inventory_bulk_transfer_completed: 'Transferência em lote',
  inventory_person_created: 'Colaborador criado',
  inventory_person_updated: 'Colaborador editado',
  inventory_person_archived: 'Colaborador arquivado',
  inventory_person_restored: 'Colaborador restaurado',
  inventory_category_created: 'Categoria criada',
  inventory_category_updated: 'Categoria editada',
  inventory_department_created: 'Setor criado',
  inventory_department_updated: 'Setor editado',
  inventory_location_created: 'Local criado',
  inventory_location_updated: 'Local editado',
  inventory_role_assigned: 'Acesso concedido',
  inventory_role_revoked: 'Acesso revogado',
}

const ENTITY_LABELS: Record<string, string> = {
  InventoryEquipment: 'Equipamento',
  InventoryPerson: 'Colaborador',
  InventoryCategory: 'Categoria',
  InventoryDepartment: 'Setor',
  InventoryLocation: 'Local',
  InventoryMovement: 'Movimentação',
  InventoryTerm: 'Termo',
  InventoryReceiving: 'Recebimento',
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/^inventory_/, '').replace(/_/g, ' ')
}

function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType
}

export function AuditPage() {
  return <InventoryGate><AuditContent /></InventoryGate>
}

function AuditContent() {
  const context = useInventoryContext()
  const { authorizedFetch } = useSession()
  const [data, setData] = useState<AuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 50

  const lastQuery = useRef('')

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (action) params.set('action', action)
    if (entityType) params.set('entityType', entityType)
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))

    const queryStr = params.toString()
    if (queryStr === lastQuery.current) return
    lastQuery.current = queryStr

    setLoading(true)
    setError(null)
    try {
      const resp = await authorizedFetch(`/api/inventory/reports/audit?${queryStr}`)
      if (!resp.ok) throw new Error(await readApiError(resp, 'Erro ao carregar auditoria.'))
      setData(await resp.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido.')
    } finally {
      setLoading(false)
    }
  }, [authorizedFetch, q, action, entityType, dateFrom, dateTo, page])

  useEffect(() => { void load() }, [load])

  if (!context.canAdmin) {
    return (
      <div className={styles.inventoryContent}>
        <p className={styles.empty}>Acesso restrito a administradores.</p>
      </div>
    )
  }

  return (
    <div className={styles.inventoryContent}>
      <div className={styles.pageHeader}>
        <div>
          <h1>Auditoria</h1>
          <p className={styles.notice}>Registro de todas as ações realizadas no inventário.</p>
        </div>
      </div>

      {/* Filtros */}
      <div className={styles.filterBar}>
        <div className={styles.filterBarFields}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Buscar</label>
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); lastQuery.current = '' }}
              placeholder="Ação, tipo, ID, usuário…"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Tipo de ação</label>
            <select
              value={action}
              onChange={(e) => { setAction(e.target.value); setPage(1); lastQuery.current = '' }}
            >
              <option value="">Todas</option>
              {Object.entries(ACTION_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Entidade</label>
            <select
              value={entityType}
              onChange={(e) => { setEntityType(e.target.value); setPage(1); lastQuery.current = '' }}
            >
              <option value="">Todas</option>
              {Object.entries(ENTITY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>De</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); lastQuery.current = '' }}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Até</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); lastQuery.current = '' }}
            />
          </div>
        </div>
        <div className={styles.filterBarActions}>
          <button
            onClick={() => {
              setQ(''); setAction(''); setEntityType('')
              setDateFrom(''); setDateTo(''); setPage(1)
              lastQuery.current = ''
            }}
          >
            Limpar
          </button>
        </div>
      </div>

      {error && <p className={styles.empty} style={{ color: 'var(--color-danger)' }}>{error}</p>}

      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Data/hora</th>
              <th>Ação</th>
              <th>Entidade</th>
              <th>ID</th>
              <th>Usuário</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className={styles.empty}>Carregando…</td></tr>
            )}
            {!loading && (!data || data.items.length === 0) && (
              <tr><td colSpan={6} className={styles.empty}>Nenhum registro encontrado.</td></tr>
            )}
            {!loading && data?.items.map((item) => (
              <>
                <tr key={item.id}>
                  <td className={styles.muted} style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>
                    {formatDateTime(item.createdAt)}
                  </td>
                  <td>{actionLabel(item.action)}</td>
                  <td className={styles.muted}>{entityLabel(item.entityType)}</td>
                  <td className={styles.muted} style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>
                    {item.entityId.slice(0, 12)}…
                  </td>
                  <td>{item.userName ?? item.bitrixUserId}</td>
                  <td>
                    {item.metadata && (
                      <button
                        className={styles.linkButton}
                        style={{ fontSize: '0.78rem' }}
                        onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                      >
                        {expanded === item.id ? 'fechar' : 'detalhes'}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === item.id && item.metadata && (
                  <tr key={`${item.id}-detail`}>
                    <td colSpan={6} style={{ padding: '0.5rem 1rem 1rem', background: 'var(--color-bg-subtle)' }}>
                      <AuditMetadata metadata={item.metadata} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className={styles.tableFooter}>
          <div className={styles.tableFooterLeft}>
            <span className={styles.tableCount}>
              {data.total} registro{data.total !== 1 ? 's' : ''}
            </span>
          </div>
          <div className={styles.paginationActions}>
            <button disabled={page <= 1} onClick={() => { setPage(page - 1); lastQuery.current = '' }}>
              ← Anterior
            </button>
            <span className={styles.muted}>
              {page} / {data.totalPages}
            </span>
            <button
              disabled={page >= data.totalPages}
              onClick={() => { setPage(page + 1); lastQuery.current = '' }}
            >
              Próxima →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AuditMetadata({ metadata }: { metadata: Record<string, unknown> }) {
  const { changedFields, before, after, origin, movementId } = metadata as {
    changedFields?: string[]
    before?: Record<string, unknown>
    after?: Record<string, unknown>
    origin?: string
    movementId?: string | null
  }

  return (
    <div style={{ fontSize: '0.82rem', lineHeight: 1.7 }}>
      {origin && (
        <div><span style={{ color: 'var(--color-text-muted)' }}>Origem:</span> {origin}</div>
      )}
      {movementId && (
        <div><span style={{ color: 'var(--color-text-muted)' }}>Movimentação:</span> {movementId}</div>
      )}
      {changedFields && changedFields.length > 0 && (
        <div style={{ marginTop: '0.5rem' }}>
          <div style={{ color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '0.25rem' }}>
            Campos alterados:
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 600, paddingRight: '1rem', width: '160px' }}>Campo</th>
                <th style={{ textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 600, paddingRight: '1rem' }}>Antes</th>
                <th style={{ textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 600 }}>Depois</th>
              </tr>
            </thead>
            <tbody>
              {changedFields.map((field) => (
                <tr key={field}>
                  <td style={{ paddingRight: '1rem', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{field}</td>
                  <td style={{ paddingRight: '1rem', color: 'var(--color-danger)' }}>
                    {before && field in before ? formatMetaValue(before[field]) : <span style={{ opacity: 0.4 }}>—</span>}
                  </td>
                  <td style={{ color: 'var(--color-success)' }}>
                    {after && field in after ? formatMetaValue(after[field]) : <span style={{ opacity: 0.4 }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function formatMetaValue(value: unknown): string {
  if (value === null || value === undefined) return '(vazio)'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

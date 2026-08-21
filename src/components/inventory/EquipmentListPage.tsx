'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { EQUIPMENT_STATUS_LABELS, equipmentLabel, readApiError, statusTone } from './format'
import { InventoryGate } from './InventoryGate'
import type {
  EquipmentListResponse,
  InventoryContextResponse,
  InventoryLookupsResponse,
} from './types'
import styles from './inventory.module.css'

interface Filters {
  q: string
  status: string
  categoryId: string
  departmentId: string
  locationId: string
}

const EMPTY_FILTERS: Filters = {
  q: '',
  status: '',
  categoryId: '',
  departmentId: '',
  locationId: '',
}

export function EquipmentListPage() {
  return <InventoryGate>{(context) => <EquipmentListContent context={context} />}</InventoryGate>
}

function EquipmentListContent({ context }: { context: InventoryContextResponse }) {
  const searchParams = useSearchParams()
  const { authorizedFetch } = useSession()
  const [draft, setDraft] = useState<Filters>(() => ({
    ...EMPTY_FILTERS,
    status: searchParams.get('status') ?? '',
  }))
  const [filters, setFilters] = useState<Filters>(() => ({
    ...EMPTY_FILTERS,
    status: searchParams.get('status') ?? '',
  }))
  const [page, setPage] = useState(1)
  const [data, setData] = useState<EquipmentListResponse | null>(null)
  const [lookups, setLookups] = useState<InventoryLookupsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadLookups = useCallback(async () => {
    const response = await authorizedFetch('/api/inventory/lookups')
    if (!response.ok)
      throw new Error(await readApiError(response, 'Não foi possível carregar os filtros.'))
    setLookups((await response.json()) as InventoryLookupsResponse)
  }, [authorizedFetch])

  const loadEquipment = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: '25' })
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    const response = await authorizedFetch(`/api/inventory/equipment?${params}`)
    if (!response.ok)
      throw new Error(await readApiError(response, 'Não foi possível carregar os equipamentos.'))
    setData((await response.json()) as EquipmentListResponse)
  }, [authorizedFetch, filters, page])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([loadLookups(), loadEquipment()])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar os equipamentos.')
    } finally {
      setLoading(false)
    }
  }, [loadEquipment, loadLookups])

  useEffect(() => {
    void load()
  }, [load])

  function applyFilters(event: FormEvent) {
    event.preventDefault()
    setPage(1)
    setFilters(draft)
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
    setPage(1)
  }

  const totalPages =
    data?.totalPages ?? Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25)))

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <h1>Equipamentos</h1>
          <p className={styles.subtitle}>
            {data ? `${data.total} item(ns) encontrado(s)` : 'Catálogo de ativos de TI'}
          </p>
        </div>
        {context.canEdit && (
          <Link href="/inventory/equipment/new">
            <button type="button" className="primary">
              + Novo equipamento
            </button>
          </Link>
        )}
      </header>

      <form className={styles.filters} onSubmit={applyFilters}>
        <div className={styles.field}>
          <label htmlFor="equipment-q">Buscar</label>
          <input
            id="equipment-q"
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            placeholder="Código, patrimônio, nome ou série"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="equipment-status">Situação</label>
          <select
            id="equipment-status"
            value={draft.status}
            onChange={(event) => setDraft({ ...draft, status: event.target.value })}
          >
            <option value="">Todas</option>
            {Object.entries(EQUIPMENT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="equipment-category">Categoria</label>
          <select
            id="equipment-category"
            value={draft.categoryId}
            onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
          >
            <option value="">Todas</option>
            {lookups?.categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="equipment-department">Setor</label>
          <select
            id="equipment-department"
            value={draft.departmentId}
            onChange={(event) => setDraft({ ...draft, departmentId: event.target.value })}
          >
            <option value="">Todos</option>
            {lookups?.departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.actions}>
          <button type="submit" className="primary">
            Filtrar
          </button>
          <button type="button" onClick={clearFilters}>
            Limpar
          </button>
        </div>
      </form>

      {error && <p className="alert alert-error">{error}</p>}
      {loading && <p className={styles.loading}>Carregando equipamentos…</p>}
      {!loading && data && data.items.length === 0 && (
        <p className={`${styles.card} ${styles.empty}`}>Nenhum equipamento encontrado.</p>
      )}

      {!loading && data && data.items.length > 0 && (
        <>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Identificação</th>
                  <th>Categoria</th>
                  <th>Situação</th>
                  <th>Responsável</th>
                  <th>Setor</th>
                  <th>Local</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => {
                  const tone = statusTone(item.status)
                  return (
                    <tr key={item.id}>
                      <td>
                        <Link href={`/inventory/equipment/${item.id}`}>{equipmentLabel(item)}</Link>
                        {item.assetTag && (
                          <div className={styles.timelineMeta}>Patrimônio: {item.assetTag}</div>
                        )}
                      </td>
                      <td>{item.category.name}</td>
                      <td>
                        <span
                          className={`${styles.badge} ${tone === 'neutral' ? '' : styles[tone]}`}
                        >
                          {EQUIPMENT_STATUS_LABELS[item.status]}
                        </span>
                      </td>
                      <td>{item.currentHolder?.name ?? '—'}</td>
                      <td>{item.department?.name ?? '—'}</td>
                      <td>{item.location?.name ?? '—'}</td>
                      <td>
                        <Link href={`/inventory/equipment/${item.id}`}>Abrir</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.pagination}>
            <span>
              Página {data.page} de {totalPages} · {data.total} registro(s)
            </span>
            <div className={styles.paginationActions}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { EQUIPMENT_STATUS_LABELS, equipmentLabel, readApiError, statusTone } from './format'
import { InventoryGate } from './InventoryGate'
import type {
  EquipmentListResponse,
  EquipmentSummary,
  InventoryContextResponse,
  InventoryLookupsResponse,
} from './types'
import styles from './inventory.module.css'

type SortField =
  | 'updatedAt'
  | 'createdAt'
  | 'patrimony'
  | 'name'
  | 'category'
  | 'status'
  | 'holder'
  | 'department'
  | 'location'
type SortDir = 'asc' | 'desc'

interface Filters {
  q: string
  status: string
  categoryId: string
  categoryIds: string
  departmentId: string
  locationId: string
  archived: string
  sort: SortField
  dir: SortDir
  pageSize: string
}

const DEFAULT_FILTERS: Filters = {
  q: '',
  status: '',
  categoryId: '',
  categoryIds: '',
  departmentId: '',
  locationId: '',
  archived: 'exclude',
  sort: 'updatedAt',
  dir: 'desc',
  pageSize: '25',
}

const PAGE_SIZE_OPTIONS = ['25', '50', '100']

const CATEGORY_GROUPS = [
  { key: 'computers', label: 'Computadores', description: 'Desktops e notebooks', match: /desktop|notebook|computador/i },
  { key: 'phones', label: 'Celulares', description: 'Smartphones e tablets', match: /smartphone|celular|tablet/i },
  { key: 'monitors', label: 'Monitores', description: 'Telas e periféricos visuais', match: /monitor/i },
] as const

function groupCategoryIds(
  categories: InventoryLookupsResponse['categories'],
  key: (typeof CATEGORY_GROUPS)[number]['key'] | 'other',
) {
  if (key === 'other') {
    return categories
      .filter((category) => !CATEGORY_GROUPS.some((group) => group.match.test(category.name)))
      .map((category) => category.id)
  }
  return categories
    .filter((category) => CATEGORY_GROUPS.find((group) => group.key === key)?.match.test(category.name))
    .map((category) => category.id)
}

export function EquipmentListPage() {
  return <InventoryGate>{(context) => <EquipmentListContent context={context} />}</InventoryGate>
}

function filtersFromParams(params: URLSearchParams): Filters {
  return {
    q: params.get('q') ?? '',
    status: params.get('status') ?? '',
    categoryId: params.get('categoryId') ?? '',
    categoryIds: params.get('categoryIds') ?? '',
    departmentId: params.get('departmentId') ?? '',
    locationId: params.get('locationId') ?? '',
    archived: params.get('archived') ?? 'exclude',
    sort: (params.get('sort') as SortField) ?? 'updatedAt',
    dir: (params.get('dir') as SortDir) ?? 'desc',
    pageSize: params.get('pageSize') ?? '25',
  }
}

function filtersToParams(filters: Filters, page: number): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.status) params.set('status', filters.status)
  if (filters.categoryId) params.set('categoryId', filters.categoryId)
  if (filters.categoryIds) params.set('categoryIds', filters.categoryIds)
  if (filters.departmentId) params.set('departmentId', filters.departmentId)
  if (filters.locationId) params.set('locationId', filters.locationId)
  if (filters.archived !== 'exclude') params.set('archived', filters.archived)
  if (filters.sort !== 'updatedAt') params.set('sort', filters.sort)
  if (filters.dir !== 'desc') params.set('dir', filters.dir)
  if (filters.pageSize !== '25') params.set('pageSize', filters.pageSize)
  if (page > 1) params.set('page', String(page))
  return params
}

function EquipmentListContent({ context }: { context: InventoryContextResponse }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { authorizedFetch } = useSession()

  const [filters, setFilters] = useState<Filters>(() => filtersFromParams(searchParams))
  const [draft, setDraft] = useState<Filters>(() => filtersFromParams(searchParams))
  const [page, setPage] = useState(() => Number(searchParams.get('page') ?? '1'))
  const [data, setData] = useState<EquipmentListResponse | null>(null)
  const [lookups, setLookups] = useState<InventoryLookupsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const lookupsLoaded = useRef(false)
  const initialGroupApplied = useRef(false)

  const loadLookups = useCallback(async () => {
    if (lookupsLoaded.current) return
    const response = await authorizedFetch('/api/inventory/lookups')
    if (!response.ok)
      throw new Error(await readApiError(response, 'Não foi possível carregar os filtros.'))
    setLookups((await response.json()) as InventoryLookupsResponse)
    lookupsLoaded.current = true
  }, [authorizedFetch])

  const loadEquipment = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: filters.pageSize })
    if (filters.q) params.set('q', filters.q)
    if (filters.status) params.set('status', filters.status)
    if (filters.categoryId) params.set('categoryId', filters.categoryId)
    if (filters.categoryIds) params.set('categoryIds', filters.categoryIds)
    if (filters.departmentId) params.set('departmentId', filters.departmentId)
    if (filters.locationId) params.set('locationId', filters.locationId)
    if (filters.archived !== 'exclude') params.set('archived', filters.archived)
    params.set('sort', filters.sort)
    params.set('dir', filters.dir)
    const response = await authorizedFetch(`/api/inventory/equipment?${params}`)
    if (!response.ok)
      throw new Error(await readApiError(response, 'Não foi possível carregar os equipamentos.'))
    setData((await response.json()) as EquipmentListResponse)
    setSelectedIds(new Set())
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

  // A tela abre em Computadores para não misturar PC, monitor e celular logo de saída.
  useEffect(() => {
    if (initialGroupApplied.current || !lookups || filters.categoryId || filters.categoryIds) return
    initialGroupApplied.current = true
    const computerIds = groupCategoryIds(lookups.categories, 'computers')
    if (!computerIds.length) return
    const next = { ...filters, categoryIds: computerIds.join(',') }
    setFilters(next)
    setDraft(next)
    setPage(1)
  }, [filters, lookups])

  // Keep URL in sync with current state
  useEffect(() => {
    const params = filtersToParams(filters, page)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : '/inventory/equipment', { scroll: false })
  }, [filters, page, router])

  function applyFilters() {
    setPage(1)
    setFilters(draft)
  }

  function clearFilters() {
    const clean = { ...DEFAULT_FILTERS }
    setDraft(clean)
    setFilters(clean)
    setPage(1)
  }

  function handleSort(field: SortField) {
    const nextDir: SortDir =
      filters.sort === field && filters.dir === 'desc' ? 'asc' : 'desc'
    const next = { ...filters, sort: field, dir: nextDir }
    setFilters(next)
    setDraft(next)
    setPage(1)
  }

  function selectCategoryGroup(key: (typeof CATEGORY_GROUPS)[number]['key'] | 'other' | 'all') {
    const ids = key === 'all' ? [] : groupCategoryIds(lookups?.categories ?? [], key)
    const next = { ...filters, categoryId: '', categoryIds: ids.join(',') }
    setFilters(next)
    setDraft(next)
    setPage(1)
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (!data) return
    if (selectedIds.size === data.items.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(data.items.map((item) => item.id)))
    }
  }

  const totalPages =
    data?.totalPages ?? Math.max(1, Math.ceil((data?.total ?? 0) / Number(filters.pageSize)))

  const hasFilters =
    filters.q ||
    filters.status ||
    filters.categoryId ||
    filters.categoryIds ||
    filters.departmentId ||
    filters.locationId ||
    filters.archived !== 'exclude'

  // Build CSV export URL with current filters
  function exportUrl() {
    const params = new URLSearchParams()
    if (filters.status) params.set('status', filters.status)
    if (filters.categoryId) params.set('categoryId', filters.categoryId)
    if (filters.categoryIds) params.set('categoryIds', filters.categoryIds)
    if (filters.departmentId) params.set('departmentId', filters.departmentId)
    if (filters.locationId) params.set('locationId', filters.locationId)
    if (filters.q) params.set('q', filters.q)
    if (filters.archived !== 'exclude') params.set('archived', filters.archived)
    const qs = params.toString()
    return `/api/inventory/reports/equipment.csv${qs ? `?${qs}` : ''}`
  }

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <h1>Equipamentos</h1>
          <p className={styles.subtitle}>
            {data
              ? `${data.total} equipamento(s)${hasFilters ? ' com os filtros aplicados' : ''}`
              : 'Inventário de ativos de TI'}
          </p>
        </div>
        <div className={styles.actions}>
          <a href={exportUrl()} target="_blank" rel="noopener noreferrer">
            <button type="button">↓ Exportar CSV</button>
          </a>
          {context.canEdit && (
            <Link href="/inventory/equipment/new">
              <button type="button" className="primary">
                + Novo equipamento
              </button>
            </Link>
          )}
        </div>
      </header>

      {lookups && (
        <section className={styles.categoryWorkbench} aria-label="Separar equipamentos por tipo">
          <div className={styles.categoryWorkbenchIntro}>
            <span className={styles.eyebrow}>Navegação rápida</span>
            <strong>Trabalhe por tipo de ativo</strong>
            <small>Computadores, celulares e monitores ficam em listas separadas.</small>
          </div>
          <div className={styles.categoryGroups}>
            <CategoryGroupButton label="Todos" description="Inventário completo" active={!filters.categoryId && !filters.categoryIds} onClick={() => selectCategoryGroup('all')} />
            {CATEGORY_GROUPS.map((group) => {
              const ids = groupCategoryIds(lookups.categories, group.key)
              if (!ids.length) return null
              return <CategoryGroupButton key={group.key} label={group.label} description={group.description} active={filters.categoryIds === ids.join(',')} onClick={() => selectCategoryGroup(group.key)} />
            })}
            {groupCategoryIds(lookups.categories, 'other').length > 0 && <CategoryGroupButton label="Outros" description="Coletores, rádios e servidores" active={filters.categoryIds === groupCategoryIds(lookups.categories, 'other').join(',')} onClick={() => selectCategoryGroup('other')} />}
          </div>
        </section>
      )}

      {/* Filtros */}
      <div className={styles.filterBar}>
        <div className={styles.filterBarFields}>
          <div className={styles.field}>
            <label htmlFor="eq-q">Buscar</label>
            <input
              id="eq-q"
              value={draft.q}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              placeholder="Patrimônio, TAG, nome, série, responsável…"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="eq-status">Situação</label>
            <select
              id="eq-status"
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })}
            >
              <option value="">Todas</option>
              {Object.entries(EQUIPMENT_STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="eq-category">Categoria</label>
            <select
              id="eq-category"
              value={draft.categoryId}
              onChange={(e) => setDraft({ ...draft, categoryId: e.target.value, categoryIds: '' })}
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
            <label htmlFor="eq-dept">Setor</label>
            <select
              id="eq-dept"
              value={draft.departmentId}
              onChange={(e) => setDraft({ ...draft, departmentId: e.target.value })}
            >
              <option value="">Todos</option>
              {lookups?.departments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="eq-location">Local</label>
            <select
              id="eq-location"
              value={draft.locationId}
              onChange={(e) => setDraft({ ...draft, locationId: e.target.value })}
            >
              <option value="">Todos</option>
              {lookups?.locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="eq-archived">Arquivados</label>
            <select
              id="eq-archived"
              value={draft.archived}
              onChange={(e) => setDraft({ ...draft, archived: e.target.value })}
            >
              <option value="exclude">Ocultar</option>
              <option value="include">Incluir</option>
              <option value="only">Somente arquivados</option>
            </select>
          </div>
        </div>
        <div className={styles.filterBarActions}>
          <button type="button" className="primary" onClick={applyFilters}>
            Filtrar
          </button>
          {hasFilters && (
            <button type="button" onClick={clearFilters}>
              Limpar
            </button>
          )}
        </div>
      </div>

      {error && <p className="alert alert-error">{error}</p>}
      {loading && <p className={styles.loading}>Carregando equipamentos…</p>}

      {!loading && data && data.items.length === 0 && (
        <p className={`${styles.card} ${styles.empty}`}>
          {hasFilters
            ? 'Nenhum equipamento encontrado com esses filtros.'
            : 'Nenhum equipamento cadastrado ainda.'}
        </p>
      )}

      {!loading && data && data.items.length > 0 && (
        <>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.size === data.items.length && data.items.length > 0}
                      onChange={toggleSelectAll}
                      title="Selecionar todos"
                    />
                  </th>
                  <SortHeader field="patrimony" current={filters} onSort={handleSort}>
                    Identificação
                  </SortHeader>
                  <SortHeader field="category" current={filters} onSort={handleSort}>
                    Categoria
                  </SortHeader>
                  <SortHeader field="status" current={filters} onSort={handleSort}>
                    Situação
                  </SortHeader>
                  <SortHeader field="holder" current={filters} onSort={handleSort}>
                    Responsável
                  </SortHeader>
                  <SortHeader field="department" current={filters} onSort={handleSort}>
                    Setor
                  </SortHeader>
                  <SortHeader field="location" current={filters} onSort={handleSort}>
                    Local
                  </SortHeader>
                  <th style={{ width: context.canEdit ? 120 : 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <EquipmentRow
                    key={item.id}
                    item={item}
                    canEdit={context.canEdit}
                    selected={selectedIds.has(item.id)}
                    onToggle={toggleSelect}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.tableFooter}>
            <div className={styles.tableFooterLeft}>
              <span className={styles.tableCount}>
                {data.total} registro(s) · página {data.page} de {totalPages}
                {selectedIds.size > 0 && ` · ${selectedIds.size} selecionado(s)`}
              </span>
              <label className={styles.pageSizeLabel}>
                Exibir:
                <select
                  value={filters.pageSize}
                  onChange={(e) => {
                    const next = { ...filters, pageSize: e.target.value }
                    setFilters(next)
                    setDraft(next)
                    setPage(1)
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className={styles.paginationActions}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((v) => Math.max(1, v - 1))}
              >
                ← Anterior
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((v) => v + 1)}
              >
                Próxima →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SortHeader({
  field,
  current,
  onSort,
  children,
}: {
  field: SortField
  current: Filters
  onSort: (field: SortField) => void
  children: React.ReactNode
}) {
  const active = current.sort === field
  const icon = active ? (current.dir === 'asc' ? ' ▲' : ' ▼') : ''
  return (
    <th
      className={`${styles.sortableHeader} ${active ? styles.sortActive : ''}`}
      onClick={() => onSort(field)}
      title={`Ordenar por ${String(children)}`}
    >
      {children}
      <span className={styles.sortIcon}>{icon || ' ⇅'}</span>
    </th>
  )
}

function CategoryGroupButton({ label, description, active, onClick }: { label: string; description: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={`${styles.categoryGroup} ${active ? styles.categoryGroupActive : ''}`} onClick={onClick}>
    <strong>{label}</strong><span>{description}</span>
  </button>
}

function EquipmentRow({
  item,
  canEdit,
  selected,
  onToggle,
}: {
  item: EquipmentSummary
  canEdit: boolean
  selected: boolean
  onToggle: (id: string) => void
}) {
  const tone = statusTone(item.status)
  const label = equipmentLabel(item)
  const isArchived = !!item.archivedAt

  return (
    <tr className={isArchived ? styles.rowArchived : ''}>
      <td>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(item.id)}
          title="Selecionar"
        />
      </td>
      <td>
        <Link href={`/inventory/equipment/${item.id}`} className={styles.equipmentLink}>
          {label}
        </Link>
        <div className={styles.timelineMeta}>
          {[item.assetTag && `Patrim. ${item.assetTag}`, item.serialNumber && `S/N ${item.serialNumber}`]
            .filter(Boolean)
            .join(' · ') || null}
        </div>
        {isArchived && (
          <span className={`${styles.badge} ${styles.archivedBadge}`}>Arquivado</span>
        )}
      </td>
      <td>{item.category.name}</td>
      <td>
        <span className={`${styles.badge} ${tone === 'neutral' ? '' : styles[tone]}`}>
          {EQUIPMENT_STATUS_LABELS[item.status]}
        </span>
      </td>
      <td>
        {item.currentHolder ? (
          <Link href={`/inventory/people/${item.currentHolder.id}`}>{item.currentHolder.name}</Link>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </td>
      <td>{item.department?.name ?? <span className={styles.muted}>—</span>}</td>
      <td>{item.location?.name ?? <span className={styles.muted}>—</span>}</td>
      <td>
        <div className={styles.rowActions}>
          <Link href={`/inventory/equipment/${item.id}`}>Ver</Link>
          {canEdit && !isArchived && (
            <Link href={`/inventory/equipment/${item.id}/edit`}>Editar</Link>
          )}
        </div>
      </td>
    </tr>
  )
}

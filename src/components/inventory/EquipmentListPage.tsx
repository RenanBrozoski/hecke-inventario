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
  InventoryFieldLookup,
  InventoryLookupsResponse,
} from './types'
import { SearchableSelect } from './SearchableSelect'
import styles from './inventory.module.css'

// ── Column visibility (localStorage per categoryId or 'all') ──────────────
const BUILTIN_COLS = ['patrimony', 'category', 'status', 'holder', 'department', 'location'] as const
type BuiltinCol = (typeof BUILTIN_COLS)[number]

function colsKey(categoryId: string) {
  return `inv:cols:${categoryId || 'all'}`
}

function loadHiddenCols(categoryId: string): Set<string> {
  try {
    const raw = localStorage.getItem(colsKey(categoryId))
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch { /* ignore */ }
  return new Set()
}

function saveHiddenCols(categoryId: string, hidden: Set<string>) {
  try {
    localStorage.setItem(colsKey(categoryId), JSON.stringify(Array.from(hidden)))
  } catch { /* ignore */ }
}

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
  const [exporting, setExporting] = useState(false)
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set())
  const [colPickerOpen, setColPickerOpen] = useState(false)

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

  // A tela abre na primeira categoria cadastrada, sem misturar tipos distintos.
  useEffect(() => {
    if (initialGroupApplied.current || !lookups || filters.categoryId || filters.categoryIds) return
    initialGroupApplied.current = true
    const firstCategory = lookups.categories[0]
    if (!firstCategory) return
    const next = { ...filters, categoryId: firstCategory.id }
    setFilters(next)
    setDraft(next)
    setPage(1)
  }, [filters, lookups])

  // Load column prefs when category changes
  useEffect(() => {
    setHiddenCols(loadHiddenCols(filters.categoryId))
  }, [filters.categoryId])

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

  function selectCategory(categoryId: string) {
    const next = { ...filters, categoryId, categoryIds: '' }
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

  // Custom fields marked listVisible from current page items
  const customCols: InventoryFieldLookup[] = (() => {
    if (!data?.items.length) return []
    const seen = new Map<string, InventoryFieldLookup>()
    for (const item of data.items) {
      for (const f of item.category.fields ?? []) {
        if (f.listVisible && f.type !== 'PASSWORD' && !seen.has(f.key)) seen.set(f.key, f)
      }
    }
    return Array.from(seen.values())
  })()

  const allColLabels: Record<string, string> = {
    patrimony: 'Código interno',
    category: 'Categoria',
    status: 'Situação',
    holder: 'Responsável',
    department: 'Setor',
    location: 'Local',
    ...Object.fromEntries(customCols.map((f) => [f.key, f.label])),
  }

  function toggleCol(key: string) {
    const next = new Set(hiddenCols)
    if (next.has(key)) next.delete(key); else next.add(key)
    setHiddenCols(next)
    saveHiddenCols(filters.categoryId, next)
  }

  function colVisible(key: string) { return !hiddenCols.has(key) }

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

  async function downloadCsv() {
    setExporting(true)
    setError(null)
    try {
      const response = await authorizedFetch(exportUrl())
      if (!response.ok) throw new Error(await readApiError(response, 'Não foi possível exportar os equipamentos.'))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'inventario.csv'
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao exportar os equipamentos.')
    } finally { setExporting(false) }
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
          <div style={{ position: 'relative' }}>
            <button type="button" onClick={() => setColPickerOpen((v) => !v)}>
              ⚙ Colunas
            </button>
            {colPickerOpen && (
              <div className={styles.colPicker}>
                <strong>Colunas visíveis</strong>
                {Object.entries(allColLabels).map(([key, label]) => (
                  <label key={key} className={styles.colPickerRow}>
                    <input
                      type="checkbox"
                      checked={colVisible(key)}
                      onChange={() => toggleCol(key)}
                    />
                    {label}
                  </label>
                ))}
                <button type="button" className={styles.colPickerClose} onClick={() => setColPickerOpen(false)}>
                  Fechar
                </button>
              </div>
            )}
          </div>
          <button type="button" onClick={() => void downloadCsv()} disabled={exporting}>
            {exporting ? 'Gerando CSV…' : '↓ Exportar CSV'}
          </button>
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
        <section className={styles.categoryWorkbench} aria-label="Separar equipamentos por categoria">
          <div className={styles.categoryWorkbenchIntro}>
            <span className={styles.eyebrow}>Navegação rápida</span>
            <strong>Trabalhe por categoria</strong>
            <small>Crie e nomeie as categorias na configuração. A lista não agrupa tipos à força.</small>
          </div>
          <div className={styles.categoryGroups}>
            <CategoryGroupButton label="Todos" description="Inventário completo" active={!filters.categoryId && !filters.categoryIds} onClick={() => selectCategory('')} />
            {lookups.categories.map((category) => <CategoryGroupButton key={category.id} label={category.name} description="Ver somente esta categoria" active={filters.categoryId === category.id} onClick={() => selectCategory(category.id)} />)}
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
              placeholder="Código, TAG patrimonial, nome, série, responsável…"
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
            <SearchableSelect
              id="eq-category"
              value={draft.categoryId}
              onChange={(v) => setDraft({ ...draft, categoryId: v, categoryIds: '' })}
              options={lookups?.categories.map((item) => ({ value: item.id, label: item.name })) ?? []}
              emptyLabel="Todas"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="eq-dept">Setor</label>
            <SearchableSelect
              id="eq-dept"
              value={draft.departmentId}
              onChange={(v) => setDraft({ ...draft, departmentId: v })}
              options={lookups?.departments.map((item) => ({ value: item.id, label: item.name })) ?? []}
              emptyLabel="Todos"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="eq-location">Local</label>
            <SearchableSelect
              id="eq-location"
              value={draft.locationId}
              onChange={(v) => setDraft({ ...draft, locationId: v })}
              options={lookups?.locations.map((item) => ({ value: item.id, label: item.name })) ?? []}
              emptyLabel="Todos"
            />
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
                  {colVisible('patrimony') && <SortHeader field="patrimony" current={filters} onSort={handleSort}>Código interno</SortHeader>}
                  {colVisible('category') && <SortHeader field="category" current={filters} onSort={handleSort}>Categoria</SortHeader>}
                  {colVisible('status') && <SortHeader field="status" current={filters} onSort={handleSort}>Situação</SortHeader>}
                  {colVisible('holder') && <SortHeader field="holder" current={filters} onSort={handleSort}>Responsável</SortHeader>}
                  {colVisible('department') && <SortHeader field="department" current={filters} onSort={handleSort}>Setor</SortHeader>}
                  {colVisible('location') && <SortHeader field="location" current={filters} onSort={handleSort}>Local</SortHeader>}
                  {customCols.filter((f) => colVisible(f.key)).map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
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
                    hiddenCols={hiddenCols}
                    customCols={customCols}
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
  hiddenCols,
  customCols,
}: {
  item: EquipmentSummary
  canEdit: boolean
  selected: boolean
  onToggle: (id: string) => void
  hiddenCols: Set<string>
  customCols: InventoryFieldLookup[]
}) {
  const tone = statusTone(item.status)
  const label = equipmentLabel(item)
  const isArchived = !!item.archivedAt
  const colVisible = (key: string) => !hiddenCols.has(key)
  const specs = (item.specs ?? {}) as Record<string, unknown>

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
      {colVisible('patrimony') && (
        <td>
          <Link href={`/inventory/equipment/${item.id}`} className={styles.equipmentLink}>
            {label}
          </Link>
          <div className={styles.timelineMeta}>
            {[item.assetTag && `TAG ${item.assetTag}`, item.serialNumber && `S/N ${item.serialNumber}`]
              .filter(Boolean)
              .join(' · ') || null}
          </div>
          {isArchived && (
            <span className={`${styles.badge} ${styles.archivedBadge}`}>Arquivado</span>
          )}
        </td>
      )}
      {colVisible('category') && <td>{item.category.name}</td>}
      {colVisible('status') && (
        <td>
          <span className={`${styles.badge} ${tone === 'neutral' ? '' : styles[tone]}`}>
            {EQUIPMENT_STATUS_LABELS[item.status]}
          </span>
        </td>
      )}
      {colVisible('holder') && (
        <td>
          {item.currentHolder ? (
            <Link href={`/inventory/people/${item.currentHolder.id}`}>{item.currentHolder.name}</Link>
          ) : (
            <span className={styles.muted}>—</span>
          )}
        </td>
      )}
      {colVisible('department') && <td>{item.department?.name ?? <span className={styles.muted}>—</span>}</td>}
      {colVisible('location') && <td>{item.location?.name ?? <span className={styles.muted}>—</span>}</td>}
      {customCols.filter((f) => colVisible(f.key)).map((f) => {
        const val = specs[f.key]
        return (
          <td key={f.key} className={styles.muted}>
            {val != null && val !== '' ? String(val) : '—'}
          </td>
        )
      })}
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

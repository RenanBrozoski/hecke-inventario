'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { EMPLOYMENT_TYPE_LABELS, PERSON_STATUS_LABELS, readApiError, statusTone } from './format'
import { InventoryGate, useInventoryContext } from './InventoryGate'
import type {
  InventoryLookupsResponse,
  PeopleListResponse,
} from './types'
import { SearchableSelect } from './SearchableSelect'
import styles from './inventory.module.css'

export function PeopleListPage() {
  return <InventoryGate><PeopleListContent /></InventoryGate>
}

const BITRIX_STATUS_LABELS: Record<string, string> = {
  MATCHED: 'Vinculado',
  UNMATCHED: 'Não vinculado',
  UNREVIEWED: 'Não revisado',
  AMBIGUOUS: 'Ambíguo',
  REJECTED: 'Rejeitado',
}

type AutoMatchSuggestion = {
  person: { id: string; name: string; revision: number }
  matches: { bitrixId: string; bitrixName: string; email: string }[]
}

type BitrixImportUser = {
  bitrixId: string
  bitrixName: string
  email: string
  alreadyLinked: boolean
  linkedPersonId: string | null
  linkedPersonName: string | null
}

function PeopleListContent() {
  const context = useInventoryContext()
  const { authorizedFetch } = useSession()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [employmentType, setEmploymentType] = useState('')
  const [bitrixMatchStatus, setBitrixMatchStatus] = useState('')
  const [pageSize, setPageSize] = useState('50')
  const [applied, setApplied] = useState({
    q: '', status: '', departmentId: '', employmentType: '', bitrixMatchStatus: '',
  })
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PeopleListResponse | null>(null)
  const [lookups, setLookups] = useState<InventoryLookupsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAutoMatch, setShowAutoMatch] = useState(false)
  const [autoMatchSuggestions, setAutoMatchSuggestions] = useState<AutoMatchSuggestion[] | null>(null)
  const [autoMatchLoading, setAutoMatchLoading] = useState(false)
  const [autoMatchError, setAutoMatchError] = useState<string | null>(null)
  const [autoMatchProcessing, setAutoMatchProcessing] = useState<Set<string>>(new Set())
  const [autoMatchSkipped, setAutoMatchSkipped] = useState<Set<string>>(new Set())
  const [showImport, setShowImport] = useState(false)
  const [importUsers, setImportUsers] = useState<BitrixImportUser[] | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSelected, setImportSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize })
      for (const [key, value] of Object.entries(applied)) if (value) params.set(key, value)
      const [peopleResponse, lookupResponse] = await Promise.all([
        authorizedFetch(`/api/inventory/people?${params}`),
        lookups ? Promise.resolve(null) : authorizedFetch('/api/inventory/lookups'),
      ])
      if (!peopleResponse.ok)
        throw new Error(await readApiError(peopleResponse, 'Não foi possível carregar os colaboradores.'))
      setData((await peopleResponse.json()) as PeopleListResponse)
      if (lookupResponse) {
        if (!lookupResponse.ok)
          throw new Error(await readApiError(lookupResponse, 'Não foi possível carregar os setores.'))
        setLookups((await lookupResponse.json()) as InventoryLookupsResponse)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar os colaboradores.')
    } finally {
      setLoading(false)
    }
  }, [applied, authorizedFetch, page, pageSize, lookups])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, applied, pageSize])

  useEffect(() => {
    // carrega lookups uma vez
    if (!lookups) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyFilter(event: FormEvent) {
    event.preventDefault()
    setPage(1)
    setApplied({ q, status, departmentId, employmentType, bitrixMatchStatus })
  }

  function clearFilter() {
    setQ(''); setStatus(''); setDepartmentId(''); setEmploymentType(''); setBitrixMatchStatus('')
    setApplied({ q: '', status: '', departmentId: '', employmentType: '', bitrixMatchStatus: '' })
    setPage(1)
  }

  async function downloadCSV() {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(applied)) if (value) params.set(key, String(value))
    try {
      const response = await authorizedFetch(`/api/inventory/reports/people.csv?${params}`)
      if (!response.ok) return
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'colaboradores.csv'
      document.body.append(a); a.click()
      URL.revokeObjectURL(url); a.remove()
    } catch { /* silently fail */ }
  }

  async function loadAutoMatch() {
    setAutoMatchLoading(true)
    setAutoMatchError(null)
    try {
      const response = await authorizedFetch('/api/inventory/bitrix-suggest')
      if (!response.ok) throw new Error('Não foi possível buscar sugestões.')
      setAutoMatchSuggestions((await response.json()) as AutoMatchSuggestion[])
      setAutoMatchSkipped(new Set())
    } catch (cause) {
      setAutoMatchError(cause instanceof Error ? cause.message : 'Falha ao buscar sugestões.')
    } finally {
      setAutoMatchLoading(false)
    }
  }

  function toggleAutoMatch() {
    if (!showAutoMatch && autoMatchSuggestions === null) void loadAutoMatch()
    setShowAutoMatch((prev) => !prev)
  }

  async function loadImportPreview() {
    setImportLoading(true)
    setImportError(null)
    try {
      const response = await authorizedFetch('/api/inventory/bitrix-import')
      if (!response.ok) throw new Error('Não foi possível buscar os usuários do Bitrix24.')
      const { users } = (await response.json()) as { users: BitrixImportUser[] }
      setImportUsers(users)
      setImportSelected(new Set(users.filter((u) => !u.alreadyLinked).map((u) => u.bitrixId)))
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : 'Falha ao carregar.')
    } finally {
      setImportLoading(false)
    }
  }

  function toggleImportOpen() {
    if (!showImport && importUsers === null) void loadImportPreview()
    setShowImport((prev) => !prev)
  }

  function toggleImportUser(bitrixId: string) {
    setImportSelected((prev) => {
      const next = new Set(prev)
      if (next.has(bitrixId)) next.delete(bitrixId)
      else next.add(bitrixId)
      return next
    })
  }

  async function runImport() {
    if (importSelected.size === 0) return
    setImporting(true)
    setImportError(null)
    try {
      const response = await authorizedFetch('/api/inventory/bitrix-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: Array.from(importSelected) }),
      })
      if (!response.ok) throw new Error(await readApiError(response, 'Erro ao importar.'))
      const { created, skipped } = (await response.json()) as { created: number; skipped: number }
      setImportUsers(null)
      setShowImport(false)
      void load()
      alert(`${created} colaborador(es) importado(s).${skipped > 0 ? ` ${skipped} já existia(m).` : ''}`)
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : 'Falha ao importar.')
    } finally {
      setImporting(false)
    }
  }

  async function confirmMatch(personId: string, revision: number, bitrixUserId: string) {
    setAutoMatchProcessing((prev) => new Set(prev).add(personId))
    try {
      const response = await authorizedFetch(`/api/inventory/people/${personId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision, bitrixUserId }),
      })
      if (!response.ok) throw new Error(await readApiError(response, 'Não foi possível vincular.'))
      setAutoMatchSkipped((prev) => new Set(prev).add(personId))
      void load()
    } catch (cause) {
      setAutoMatchError(cause instanceof Error ? cause.message : 'Falha ao vincular.')
    } finally {
      setAutoMatchProcessing((prev) => { const next = new Set(prev); next.delete(personId); return next })
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <h1>Colaboradores</h1>
          <p className={styles.subtitle}>
            {data ? `${data.total} pessoa(s) encontrada(s)` : 'Responsáveis e histórico de custódia'}
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => void downloadCSV()}>↓ Exportar CSV</button>
          <button type="button" onClick={toggleAutoMatch}>⟳ Auto-vincular B24</button>
          <button type="button" onClick={toggleImportOpen}>↑ Importar do Bitrix24</button>
          {context.canAdmin && (
            <Link href="/inventory/people/dedupe">
              <button type="button">⟳ Duplicatas</button>
            </Link>
          )}
          {context.canEdit && (
            <Link href="/inventory/people/new">
              <button type="button" className="primary">+ Novo colaborador</button>
            </Link>
          )}
        </div>
      </header>

      <form className={styles.filters} onSubmit={applyFilter}>
        <div className={styles.field}>
          <label htmlFor="people-q">Buscar</label>
          <input
            id="people-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome, e-mail, CPF, cargo ou matrícula"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="people-status">Situação</label>
          <select id="people-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(PERSON_STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="people-dept">Setor</label>
          <SearchableSelect
            id="people-dept"
            value={departmentId}
            onChange={setDepartmentId}
            options={lookups?.departments.map((d) => ({ value: d.id, label: d.name })) ?? []}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="people-emp">Vínculo</label>
          <select id="people-emp" value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="people-bitrix">Bitrix24</label>
          <select id="people-bitrix" value={bitrixMatchStatus} onChange={(e) => setBitrixMatchStatus(e.target.value)}>
            <option value="">Todos</option>
            <option value="MATCHED">Vinculado</option>
            <option value="UNREVIEWED">Não revisado</option>
            <option value="UNMATCHED">Não vinculado</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="people-ps">Por página</label>
          <select id="people-ps" value={pageSize} onChange={(e) => { setPageSize(e.target.value); setPage(1) }}>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
        <div className={styles.actions}>
          <button type="submit" className="primary">Filtrar</button>
          <button type="button" onClick={clearFilter}>Limpar</button>
        </div>
      </form>

      {showAutoMatch && (
        <div className={styles.card} style={{ marginBottom: '1rem' }}>
          <div className={styles.pageHeader} style={{ marginBottom: '0.75rem' }}>
            <h2 style={{ margin: 0 }}>Auto-vincular ao Bitrix24</h2>
            <div className={styles.actions}>
              <button type="button" onClick={() => void loadAutoMatch()} disabled={autoMatchLoading}>Recarregar</button>
              <button type="button" onClick={() => setShowAutoMatch(false)}>Fechar</button>
            </div>
          </div>
          {autoMatchError && <p className="alert alert-error">{autoMatchError}</p>}
          {autoMatchLoading && <p className={styles.loading}>Buscando correspondências no Bitrix24…</p>}
          {!autoMatchLoading && autoMatchSuggestions !== null && (() => {
            const visible = autoMatchSuggestions.filter((s) => !autoMatchSkipped.has(s.person.id))
            return visible.length === 0 ? (
              <p className={styles.empty}>Nenhuma sugestão encontrada. Todos os colaboradores já estão vinculados ou foram ignorados.</p>
            ) : (
              <>
                <div className={styles.tableWrap}>
                  <table>
                    <thead><tr><th>Colaborador</th><th>Correspondências no Bitrix24</th><th></th></tr></thead>
                    <tbody>
                      {visible.map(({ person, matches }) => (
                        <tr key={person.id}>
                          <td><Link href={`/inventory/people/${person.id}`}>{person.name}</Link></td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                              {matches.map((m) => (
                                <div key={m.bitrixId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <span style={{ fontSize: '0.9rem' }}>{m.bitrixName}{m.email ? ` · ${m.email}` : ''}</span>
                                  <button
                                    type="button"
                                    className="primary"
                                    style={{ padding: '0.1rem 0.5rem', fontSize: '0.78rem' }}
                                    disabled={autoMatchProcessing.has(person.id)}
                                    onClick={() => void confirmMatch(person.id, person.revision, m.bitrixId)}
                                  >
                                    {autoMatchProcessing.has(person.id) ? '…' : 'Vincular'}
                                  </button>
                                </div>
                              ))}
                            </div>
                          </td>
                          <td>
                            <button
                              type="button"
                              style={{ fontSize: '0.8rem', opacity: 0.65 }}
                              onClick={() => setAutoMatchSkipped((prev) => new Set(prev).add(person.id))}
                            >
                              Pular
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ marginTop: '0.5rem', fontSize: '0.82rem', opacity: 0.65 }}>
                  Mostrando até 25 colaboradores ativos sem vínculo Bitrix24. Após vincular, recarregue para ver as mudanças na lista.
                </p>
              </>
            )
          })()}
        </div>
      )}

      {showImport && (
        <div className={styles.card} style={{ marginBottom: '1rem' }}>
          <div className={styles.pageHeader} style={{ marginBottom: '0.75rem' }}>
            <h2 style={{ margin: 0 }}>Importar colaboradores do Bitrix24</h2>
            <div className={styles.actions}>
              <button type="button" onClick={() => void loadImportPreview()} disabled={importLoading}>Recarregar</button>
              <button type="button" onClick={() => setShowImport(false)}>Fechar</button>
            </div>
          </div>
          <p style={{ marginBottom: '0.75rem', fontSize: '0.88rem', opacity: 0.75 }}>
            Usuários ativos do Bitrix24. Selecione os que deseja criar como colaboradores. Já vinculados são mostrados apenas como referência.
          </p>
          {importError && <p className="alert alert-error">{importError}</p>}
          {importLoading && <p className={styles.loading}>Buscando usuários do Bitrix24…</p>}
          {!importLoading && importUsers !== null && (
            <>
              <div className={styles.tableWrap} style={{ maxHeight: 360, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          checked={importSelected.size > 0 && importSelected.size === importUsers.filter((u) => !u.alreadyLinked).length}
                          onChange={(e) => {
                            if (e.target.checked) setImportSelected(new Set(importUsers.filter((u) => !u.alreadyLinked).map((u) => u.bitrixId)))
                            else setImportSelected(new Set())
                          }}
                        />
                      </th>
                      <th>Nome no Bitrix24</th>
                      <th>E-mail</th>
                      <th>No sistema</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importUsers.map((u) => (
                      <tr key={u.bitrixId} style={{ opacity: u.alreadyLinked ? 0.55 : 1 }}>
                        <td>
                          <input
                            type="checkbox"
                            checked={importSelected.has(u.bitrixId)}
                            disabled={u.alreadyLinked}
                            onChange={() => toggleImportUser(u.bitrixId)}
                          />
                        </td>
                        <td>{u.bitrixName}</td>
                        <td style={{ fontSize: '0.85rem' }}>{u.email || '—'}</td>
                        <td>
                          {u.alreadyLinked ? (
                            <Link href={`/inventory/people/${u.linkedPersonId}`} style={{ fontSize: '0.85rem' }}>
                              {u.linkedPersonName}
                            </Link>
                          ) : (
                            <span style={{ fontSize: '0.82rem', opacity: 0.55 }}>Não cadastrado</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="primary"
                  disabled={importing || importSelected.size === 0}
                  onClick={() => void runImport()}
                >
                  {importing ? 'Importando…' : `Importar ${importSelected.size} selecionado(s)`}
                </button>
                <span style={{ fontSize: '0.82rem', opacity: 0.6 }}>
                  {importUsers.filter((u) => u.alreadyLinked).length} já vinculado(s) · {importUsers.filter((u) => !u.alreadyLinked).length} novo(s)
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="alert alert-error">{error}</p>}
      {loading && <p className={styles.loading}>Carregando colaboradores…</p>}
      {!loading && data?.items.length === 0 && (
        <p className={`${styles.card} ${styles.empty}`}>Nenhum colaborador encontrado.</p>
      )}
      {!loading && data && data.items.length > 0 && (
        <>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Setor</th>
                  <th>Situação</th>
                  <th>Vínculo</th>
                  <th>Equipamentos</th>
                  <th>Bitrix24</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((person) => {
                  const tone = statusTone(person.status)
                  const isLinked = person.bitrixMatchStatus === 'MATCHED'
                  return (
                    <tr key={person.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          {isLinked && (
                            <span
                              title={`Bitrix24 #${person.bitrixUserId ?? ''}`}
                              style={{ fontSize: '0.65rem', background: '#22c55e', color: '#fff', borderRadius: 3, padding: '0 4px', lineHeight: '1.6', flexShrink: 0 }}
                            >
                              B24
                            </span>
                          )}
                          <Link href={`/inventory/people/${person.id}`}>{person.name}</Link>
                        </div>
                        {person.title && <div className={styles.timelineMeta}>{person.title}</div>}
                      </td>
                      <td>{person.department?.name ?? '—'}</td>
                      <td>
                        <span className={`${styles.badge} ${tone === 'neutral' ? '' : styles[tone]}`}>
                          {PERSON_STATUS_LABELS[person.status]}
                        </span>
                      </td>
                      <td>{person.employmentType ? EMPLOYMENT_TYPE_LABELS[person.employmentType] : '—'}</td>
                      <td>{person._count?.equipment ?? 0}</td>
                      <td>
                        {isLinked ? (
                          <span className={`${styles.badge} ${styles.success}`}>Vinculado</span>
                        ) : (
                          <span className={styles.badge} style={{ opacity: 0.6 }}>
                            {BITRIX_STATUS_LABELS[person.bitrixMatchStatus ?? 'UNREVIEWED'] ?? 'Não revisado'}
                          </span>
                        )}
                      </td>
                      <td>
                        <Link href={`/inventory/people/${person.id}`}>Abrir</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.pagination}>
            <span>Página {data.page} de {totalPages} · {data.total} registro(s)</span>
            <div className={styles.paginationActions}>
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Anterior
              </button>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Próxima
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

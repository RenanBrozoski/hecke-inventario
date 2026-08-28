'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { EMPLOYMENT_TYPE_LABELS, PERSON_STATUS_LABELS, readApiError, statusTone } from './format'
import { InventoryGate } from './InventoryGate'
import type {
  InventoryContextResponse,
  InventoryLookupsResponse,
  PeopleListResponse,
} from './types'
import styles from './inventory.module.css'

export function PeopleListPage() {
  return <InventoryGate>{(context) => <PeopleListContent context={context} />}</InventoryGate>
}

const BITRIX_STATUS_LABELS: Record<string, string> = {
  MATCHED: 'Vinculado',
  UNMATCHED: 'Não vinculado',
  UNREVIEWED: 'Não revisado',
  AMBIGUOUS: 'Ambíguo',
  REJECTED: 'Rejeitado',
}

function PeopleListContent({ context }: { context: InventoryContextResponse }) {
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
        {context.canEdit && (
          <Link href="/inventory/people/new">
            <button type="button" className="primary">+ Novo colaborador</button>
          </Link>
        )}
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
          <select id="people-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">Todos</option>
            {lookups?.departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
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

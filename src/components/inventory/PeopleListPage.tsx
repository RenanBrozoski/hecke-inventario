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

function PeopleListContent({ context }: { context: InventoryContextResponse }) {
  const { authorizedFetch } = useSession()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [applied, setApplied] = useState({ q: '', status: '', departmentId: '' })
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PeopleListResponse | null>(null)
  const [lookups, setLookups] = useState<InventoryLookupsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' })
      for (const [key, value] of Object.entries(applied)) if (value) params.set(key, value)
      const [peopleResponse, lookupResponse] = await Promise.all([
        authorizedFetch(`/api/inventory/people?${params}`),
        authorizedFetch('/api/inventory/lookups'),
      ])
      if (!peopleResponse.ok)
        throw new Error(
          await readApiError(peopleResponse, 'Não foi possível carregar os colaboradores.'),
        )
      if (!lookupResponse.ok)
        throw new Error(await readApiError(lookupResponse, 'Não foi possível carregar os setores.'))
      setData((await peopleResponse.json()) as PeopleListResponse)
      setLookups((await lookupResponse.json()) as InventoryLookupsResponse)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar os colaboradores.')
    } finally {
      setLoading(false)
    }
  }, [applied, authorizedFetch, page])

  useEffect(() => {
    void load()
  }, [load])

  function filter(event: FormEvent) {
    event.preventDefault()
    setPage(1)
    setApplied({ q, status, departmentId })
  }

  const totalPages =
    data?.totalPages ?? Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25)))

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <h1>Colaboradores</h1>
          <p className={styles.subtitle}>
            {data
              ? `${data.total} pessoa(s) encontrada(s)`
              : 'Responsáveis e histórico de custódia'}
          </p>
        </div>
        {context.canEdit && (
          <Link href="/inventory/people/new">
            <button type="button" className="primary">
              + Novo colaborador
            </button>
          </Link>
        )}
      </header>
      <form className={styles.filters} onSubmit={filter}>
        <div className={styles.field}>
          <label htmlFor="people-q">Buscar</label>
          <input
            id="people-q"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Nome, e-mail, cargo ou matrícula"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="people-status">Situação</label>
          <select
            id="people-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Todas</option>
            {Object.entries(PERSON_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="people-department">Setor</label>
          <select
            id="people-department"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
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
          <button
            type="button"
            onClick={() => {
              setQ('')
              setStatus('')
              setDepartmentId('')
              setApplied({ q: '', status: '', departmentId: '' })
              setPage(1)
            }}
          >
            Limpar
          </button>
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
                  <th>Bitrix</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((person) => {
                  const tone = statusTone(person.status)
                  return (
                    <tr key={person.id}>
                      <td>
                        <Link href={`/inventory/people/${person.id}`}>{person.name}</Link>
                        {person.title && <div className={styles.timelineMeta}>{person.title}</div>}
                      </td>
                      <td>{person.department?.name ?? '—'}</td>
                      <td>
                        <span
                          className={`${styles.badge} ${tone === 'neutral' ? '' : styles[tone]}`}
                        >
                          {PERSON_STATUS_LABELS[person.status]}
                        </span>
                      </td>
                      <td>
                        {person.employmentType
                          ? EMPLOYMENT_TYPE_LABELS[person.employmentType]
                          : '—'}
                      </td>
                      <td>{person._count?.equipment ?? 0}</td>
                      <td>
                        {person.bitrixMatchStatus === 'MATCHED' ? (
                          <span className={`${styles.badge} ${styles.success}`}>Vinculado</span>
                        ) : (
                          <span className={styles.badge}>Não vinculado</span>
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

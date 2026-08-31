'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { equipmentLabel, formatDateTime, readApiError } from './format'
import { InventoryAttachments } from './InventoryAttachments'
import { InventoryGate, useInventoryContext } from './InventoryGate'
import type {
  EquipmentSummary,
  InventoryLookupsResponse,
  PersonDetail,
} from './types'
import styles from './inventory.module.css'

interface TermSummary {
  id: string
  type: 'DELIVERY' | 'RESPONSIBILITY' | 'RETURN' | 'TRANSFER'
  personName: string | null
  destinationPersonName: string | null
  person?: { id: string; name: string } | null
  destinationPerson?: { id: string; name: string } | null
  items: unknown
  observations: string | null
  createdByName: string | null
  createdAt: string
}
interface TermDetail extends TermSummary {
  personDepartmentName?: string | null
  destinationDepartmentName?: string | null
}
interface PageEnvelope {
  items: TermSummary[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}
const TERM_LABELS = {
  DELIVERY: 'Termo de Entrega',
  RESPONSIBILITY: 'Termo de Responsabilidade',
  RETURN: 'Termo de Devolução',
  TRANSFER: 'Termo de Transferência',
} as const
type ManualTermType = 'DELIVERY' | 'RESPONSIBILITY' | 'RETURN'
const MANUAL_TERM_TYPES: ManualTermType[] = ['DELIVERY', 'RESPONSIBILITY', 'RETURN']

export function TermsPage() {
  return <InventoryGate><TermsContent /></InventoryGate>
}
export function TermDetailPage({ termId }: { termId: string }) {
  return <InventoryGate><TermDetailContent termId={termId} /></InventoryGate>
}

function TermsContent() {
  const context = useInventoryContext()
  const { authorizedFetch } = useSession()
  const [data, setData] = useState<PageEnvelope | null>(null)
  const [lookups, setLookups] = useState<InventoryLookupsResponse | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [q, setQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [page, setPage] = useState(1)
  const [type, setType] = useState<ManualTermType>('RESPONSIBILITY')
  const [personId, setPersonId] = useState('')
  const [personEquipment, setPersonEquipment] = useState<EquipmentSummary[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [observations, setObservations] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' })
      if (appliedQ) params.set('q', appliedQ)
      const [termResponse, lookupResponse] = await Promise.all([
        authorizedFetch(`/api/inventory/terms?${params}`),
        authorizedFetch('/api/inventory/lookups'),
      ])
      if (!termResponse.ok)
        throw new Error(await readApiError(termResponse, 'Não foi possível carregar os termos.'))
      if (!lookupResponse.ok)
        throw new Error(
          await readApiError(lookupResponse, 'Não foi possível carregar os colaboradores.'),
        )
      setData((await termResponse.json()) as PageEnvelope)
      setLookups((await lookupResponse.json()) as InventoryLookupsResponse)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar os termos.')
    } finally {
      setLoading(false)
    }
  }, [appliedQ, authorizedFetch, page])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!personId) {
      setPersonEquipment([])
      setSelectedIds([])
      return
    }
    void (async () => {
      const response = await authorizedFetch(`/api/inventory/people/${personId}`)
      if (response.ok) {
        const person = (await response.json()) as PersonDetail
        setPersonEquipment(person.equipment ?? [])
        setSelectedIds((person.equipment ?? []).map((item) => item.id))
      }
    })()
  }, [authorizedFetch, personId])
  async function create(event: FormEvent) {
    event.preventDefault()
    if (!personId || selectedIds.length === 0) {
      setError('Selecione o colaborador e ao menos um equipamento.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const response = await authorizedFetch('/api/inventory/terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          personId,
          equipmentIds: selectedIds,
          expectedRevisions: Object.fromEntries(
            personEquipment
              .filter((item) => selectedIds.includes(item.id))
              .map((item) => [item.id, item.revision]),
          ),
          observations: observations.trim() || null,
        }),
      })
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível gerar o termo.'))
      const term = (await response.json()) as { id: string }
      window.location.assign(`/inventory/terms/${term.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao gerar o termo.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <h1>Termos</h1>
          <p className={styles.subtitle}>Entrega, responsabilidade, devolução e transferência</p>
        </div>
        {context.canEdit && (
          <button
            type="button"
            className={showForm ? '' : 'primary'}
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? 'Cancelar' : '+ Gerar termo'}
          </button>
        )}
      </header>
      {showForm && (
        <form className={styles.card} onSubmit={create} style={{ marginBottom: '1rem' }}>
          <h2>Novo termo</h2>
          <div className={styles.formGrid}>
            <Field label="Tipo">
              <select
                value={type}
                onChange={(event) => setType(event.target.value as ManualTermType)}
              >
                {MANUAL_TERM_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {TERM_LABELS[value]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Colaborador de origem">
              <select
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
                required
              >
                <option value="">Selecione…</option>
                {lookups?.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className={styles.spanTwo}>
              <span className={styles.fieldLabel}>Equipamentos</span>
              {personId && personEquipment.length === 0 ? (
                <p className={styles.notice}>Essa pessoa não possui equipamentos atuais.</p>
              ) : (
                personEquipment.map((item) => (
                  <label key={item.id} style={{ display: 'block', marginBottom: '0.35rem' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={(event) =>
                        setSelectedIds((current) =>
                          event.target.checked
                            ? [...current, item.id]
                            : current.filter((id) => id !== item.id),
                        )
                      }
                    />{' '}
                    {equipmentLabel(item)} · {item.category.name}
                  </label>
                ))
              )}
            </div>
            <div className={styles.spanTwo}>
              <Field label="Observações">
                <textarea
                  value={observations}
                  onChange={(event) => setObservations(event.target.value)}
                />
              </Field>
            </div>
          </div>
          <button className="primary" type="submit" disabled={saving || !personEquipment.length}>
            {saving ? 'Gerando…' : 'Gerar termo'}
          </button>
        </form>
      )}
      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault()
          setAppliedQ(q)
          setPage(1)
        }}
      >
        <div className={styles.field}>
          <label>Buscar</label>
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Nome ou observação"
          />
        </div>
        <button type="submit" className="primary">
          Buscar
        </button>
      </form>
      {error && <p className="alert alert-error">{error}</p>}
      {loading ? (
        <p className={styles.loading}>Carregando termos…</p>
      ) : !data?.items.length ? (
        <p className={`${styles.card} ${styles.empty}`}>Nenhum termo encontrado.</p>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Origem</th>
                  <th>Destino</th>
                  <th>Criado por</th>
                  <th>Data</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((term) => (
                  <tr key={term.id}>
                    <td>{TERM_LABELS[term.type]}</td>
                    <td>{term.personName || '—'}</td>
                    <td>{term.destinationPersonName || '—'}</td>
                    <td>{term.createdByName || '—'}</td>
                    <td>{formatDateTime(term.createdAt)}</td>
                    <td>
                      <Link href={`/inventory/terms/${term.id}`}>Abrir</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.pagination}>
            <span>
              Página {data.page} de {Math.max(1, data.totalPages)} · {data.total} registro(s)
            </span>
            <div className={styles.paginationActions}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(Math.max(1, page - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
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

function TermDetailContent({ termId }: { termId: string }) {
  const context = useInventoryContext()
  const { authorizedFetch } = useSession()
  const [term, setTerm] = useState<TermDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void (async () => {
      try {
        const response = await authorizedFetch(`/api/inventory/terms/${termId}`)
        if (!response.ok) throw new Error(await readApiError(response, 'Termo não encontrado.'))
        setTerm((await response.json()) as TermDetail)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Falha ao carregar o termo.')
      }
    })()
  }, [authorizedFetch, termId])
  if (error) return <p className="alert alert-error">{error}</p>
  if (!term) return <p className={styles.loading}>Carregando termo…</p>
  const items = Array.isArray(term.items) ? (term.items as Array<Record<string, unknown>>) : []
  return (
    <div>
      <header className={`${styles.pageHeader} ${styles.noPrint}`}>
        <div>
          <Link className="page-header__back" href="/inventory/terms">
            ← Termos
          </Link>
          <h1>{TERM_LABELS[term.type]}</h1>
        </div>
        <button type="button" className="primary" onClick={() => window.print()}>
          Imprimir / Salvar PDF
        </button>
      </header>
      <article className={`${styles.card} ${styles.printDocument}`}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1>{TERM_LABELS[term.type]}</h1>
          <p>Hecke Alimentos</p>
        </div>
        <p>
          <strong>Colaborador:</strong> {term.personName || '—'}
        </p>
        <p>
          <strong>Setor:</strong> {term.personDepartmentName || '—'}
        </p>
        {term.type === 'TRANSFER' && (
          <>
            <p>
              <strong>Novo responsável:</strong> {term.destinationPersonName || '—'}
            </p>
            <p>
              <strong>Novo setor:</strong> {term.destinationDepartmentName || '—'}
            </p>
          </>
        )}
        <h2 style={{ marginTop: '1.5rem' }}>Equipamentos</h2>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Patrimônio</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Série</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={String(item.equipmentId ?? item.id ?? index)}>
                  <td>{String(item.patrimony ?? item.patrimonio ?? '—')}</td>
                  <td>{String(item.assetTag ?? item.tag_patrimonio ?? '—')}</td>
                  <td>
                    {String(item.name ?? item.nome ?? '—')}
                    {formatVisibleSpecs(item.visibleSpecs)}
                  </td>
                  <td>{String(item.category ?? item.categoria ?? '—')}</td>
                  <td>{String(item.serialNumber ?? item.numero_serie ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: '1.5rem' }}>{legalText(term.type)}</p>
        {term.observations && (
          <p>
            <strong>Observações:</strong> {term.observations}
          </p>
        )}
        <p style={{ marginTop: '3rem' }}>
          ________________________________________
          <br />
          Assinatura do colaborador
        </p>
        <p className={styles.timelineMeta}>
          Gerado em {formatDateTime(term.createdAt)}
          {term.createdByName ? ` por ${term.createdByName}` : ''}
        </p>
      </article>
      <InventoryAttachments
        entityType="TERM"
        entityId={term.id}
        canEdit={context.canEdit}
        className={`${styles.sectionTitle} ${styles.noPrint}`}
      />
    </div>
  )
}

function formatVisibleSpecs(value: unknown) {
  const entries = Array.isArray(value)
    ? value
        .filter(
          (item): item is { label?: unknown; key?: unknown; value?: unknown } =>
            item !== null && typeof item === 'object',
        )
        .map((item) => [item.label ?? item.key, item.value] as const)
    : value && typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>)
      : []
  const visible = entries.filter(([, item]) => item !== null && item !== undefined && item !== '')
  if (visible.length === 0) return null
  return (
    <small className={styles.timelineMeta} style={{ display: 'block', marginTop: '0.25rem' }}>
      {visible.map(([label, item]) => `${String(label)}: ${String(item)}`).join(' · ')}
    </small>
  )
}

function legalText(type: keyof typeof TERM_LABELS): string {
  if (type === 'RETURN')
    return 'Declaro a devolução dos equipamentos relacionados acima, nas condições registradas neste termo.'
  if (type === 'TRANSFER')
    return 'Fica registrada a transferência de guarda dos equipamentos relacionados para o novo responsável indicado.'
  return 'Declaro o recebimento e a responsabilidade pela guarda, conservação e uso profissional dos equipamentos relacionados, comprometendo-me a comunicar danos ou extravio e a devolvê-los quando solicitado.'
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label>{label}</label>
      {children}
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/src/components/session/SessionProvider'
import { equipmentLabel, formatDate, formatDateTime, readApiError, statusTone } from './format'
import { InventoryGate } from './InventoryGate'
import type {
  CorporateLine,
  CorporateLineListResponse,
  CorporateLineStatus,
  InventoryContextResponse,
  InventoryLookupsResponse,
} from './types'
import styles from './inventory.module.css'

const STATUS_LABELS: Record<CorporateLineStatus, string> = {
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  CANCELLED: 'Cancelada',
  AVAILABLE: 'Disponível',
}

type LineForm = {
  number: string
  carrier: string
  plan: string
  dataAllowance: string
  status: CorporateLineStatus
  currentHolderId: string
  equipmentId: string
  simSlot: string
  activatedAt: string
  suspendedAt: string
  cancelledAt: string
  notes: string
}

const EMPTY_FORM: LineForm = {
  number: '', carrier: '', plan: '', dataAllowance: '', status: 'ACTIVE',
  currentHolderId: '', equipmentId: '', simSlot: '', activatedAt: '', suspendedAt: '',
  cancelledAt: '', notes: '',
}

function lineForm(line: CorporateLine): LineForm {
  return {
    number: line.number, carrier: line.carrier ?? '', plan: line.plan ?? '',
    dataAllowance: line.dataAllowance ?? '', status: line.status,
    currentHolderId: line.currentHolder?.id ?? '', equipmentId: line.equipment?.id ?? '',
    simSlot: line.simSlot ?? '', activatedAt: line.activatedAt?.slice(0, 10) ?? '',
    suspendedAt: line.suspendedAt?.slice(0, 10) ?? '',
    cancelledAt: line.cancelledAt?.slice(0, 10) ?? '', notes: line.notes ?? '',
  }
}

function payload(form: LineForm) {
  const nullable = (value: string) => value.trim() || null
  return {
    number: form.number.trim(), carrier: nullable(form.carrier), plan: nullable(form.plan),
    dataAllowance: nullable(form.dataAllowance), status: form.status,
    currentHolderId: form.currentHolderId || null, equipmentId: form.equipmentId || null,
    simSlot: nullable(form.simSlot), activatedAt: form.activatedAt || null,
    suspendedAt: form.suspendedAt || null, cancelledAt: form.cancelledAt || null,
    notes: nullable(form.notes),
  }
}

export function CorporateLinesPage() {
  return <InventoryGate>{(context) => <CorporateLinesContent context={context} />}</InventoryGate>
}

export function CorporateLineDetailPage({ lineId }: { lineId: string }) {
  return <InventoryGate>{(context) => <CorporateLineDetailContent context={context} lineId={lineId} />}</InventoryGate>
}

function CorporateLinesContent({ context }: { context: InventoryContextResponse }) {
  const { authorizedFetch } = useSession()
  const [data, setData] = useState<CorporateLineListResponse | null>(null)
  const [lookups, setLookups] = useState<InventoryLookupsResponse | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<LineForm>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    const params = new URLSearchParams({ page: '1', pageSize: '50' })
    if (q.trim()) params.set('q', q.trim())
    if (status) params.set('status', status)
    const [linesResponse, lookupsResponse] = await Promise.all([
      authorizedFetch(`/api/inventory/corporate-lines?${params}`),
      authorizedFetch('/api/inventory/lookups'),
    ])
    if (!linesResponse.ok || !lookupsResponse.ok) {
      throw new Error(await readApiError(!linesResponse.ok ? linesResponse : lookupsResponse, 'Não foi possível carregar as linhas.'))
    }
    setData((await linesResponse.json()) as CorporateLineListResponse)
    setLookups((await lookupsResponse.json()) as InventoryLookupsResponse)
  }, [authorizedFetch, q, status])

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha ao carregar.')) }, [load])

  async function create(event: FormEvent) {
    event.preventDefault()
    setSaving(true); setError(null)
    try {
      const response = await authorizedFetch('/api/inventory/corporate-lines', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(form)),
      })
      if (!response.ok) throw new Error(await readApiError(response, 'Não foi possível cadastrar a linha.'))
      setForm(EMPTY_FORM); setShowCreate(false); await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao cadastrar a linha.')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <header className={styles.pageHeader}>
        <div><h1>Linhas corporativas</h1><p className={styles.subtitle}>{data ? `${data.total} linha(s) cadastrada(s)` : 'Números, planos, SIM/eSIM e vínculos'}</p></div>
        {context.canEdit && <button type="button" className="primary" onClick={() => setShowCreate(!showCreate)}>{showCreate ? 'Cancelar' : '+ Nova linha'}</button>}
      </header>
      <div className={styles.filters}>
        <div className={styles.field}><label htmlFor="line-q">Buscar</label><input id="line-q" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Número, operadora, responsável ou aparelho" /></div>
        <div className={styles.field}><label htmlFor="line-status">Situação</label><select id="line-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todas</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className={styles.actions}><button type="button" className="primary" onClick={() => void load()}>Filtrar</button></div>
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      {showCreate && <LineFormCard form={form} setForm={setForm} people={lookups?.people ?? []} onSubmit={create} saving={saving} />}
      {!data ? <p className={styles.loading}>Carregando linhas…</p> : data.items.length === 0 ? <p className={`${styles.card} ${styles.empty}`}>Nenhuma linha corporativa encontrada.</p> : (
        <div className={`${styles.card} ${styles.tableWrap}`}>
          <table><thead><tr><th>Número</th><th>Operadora / plano</th><th>Situação</th><th>Colaborador</th><th>Equipamento / SIM</th><th></th></tr></thead><tbody>
            {data.items.map((line) => <tr key={line.id}>
              <td><Link href={`/inventory/corporate-lines/${line.id}`}>{line.number}</Link></td>
              <td>{[line.carrier, line.plan, line.dataAllowance].filter(Boolean).join(' · ') || '—'}</td>
              <td><span className={`${styles.badge} ${styles[statusTone(line.status === 'ACTIVE' ? 'ACTIVE' : line.status === 'SUSPENDED' ? 'MAINTENANCE' : 'INACTIVE')]}`}>{STATUS_LABELS[line.status]}</span></td>
              <td>{line.currentHolder ? <Link href={`/inventory/people/${line.currentHolder.id}`}>{line.currentHolder.name}</Link> : 'Sem responsável'}</td>
              <td>{line.equipment ? <Link href={`/inventory/equipment/${line.equipment.id}`}>{equipmentLabel(line.equipment)}</Link> : 'Sem aparelho'}{line.simSlot ? ` · ${line.simSlot}` : ''}</td>
              <td><Link href={`/inventory/corporate-lines/${line.id}`}>Abrir</Link></td>
            </tr>)}
          </tbody></table>
        </div>
      )}
    </div>
  )
}

function CorporateLineDetailContent({ context, lineId }: { context: InventoryContextResponse; lineId: string }) {
  const router = useRouter()
  const { authorizedFetch } = useSession()
  const [line, setLine] = useState<CorporateLine | null>(null)
  const [lookups, setLookups] = useState<InventoryLookupsResponse | null>(null)
  const [form, setForm] = useState<LineForm>(EMPTY_FORM)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    const [lineResponse, lookupResponse] = await Promise.all([authorizedFetch(`/api/inventory/corporate-lines/${lineId}`), authorizedFetch('/api/inventory/lookups')])
    if (!lineResponse.ok || !lookupResponse.ok) throw new Error(await readApiError(!lineResponse.ok ? lineResponse : lookupResponse, 'Linha não encontrada.'))
    const loaded = (await lineResponse.json()) as CorporateLine
    setLine(loaded); setForm(lineForm(loaded)); setLookups((await lookupResponse.json()) as InventoryLookupsResponse)
  }, [authorizedFetch, lineId])
  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha ao carregar.')) }, [load])
  async function save(event: FormEvent) {
    event.preventDefault(); if (!line) return; setSaving(true)
    try {
      const response = await authorizedFetch(`/api/inventory/corporate-lines/${line.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: line.revision, ...payload(form) }) })
      if (!response.ok) throw new Error(await readApiError(response, 'Não foi possível atualizar a linha.'))
      setEditing(false); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao atualizar.') } finally { setSaving(false) }
  }
  async function archive() {
    if (!line || !window.confirm(`Arquivar a linha ${line.number}? O histórico será preservado.`)) return
    const response = await authorizedFetch(`/api/inventory/corporate-lines/${line.id}?revision=${line.revision}`, { method: 'DELETE' })
    if (!response.ok) { setError(await readApiError(response, 'Não foi possível arquivar.')); return }
    router.push('/inventory/corporate-lines')
  }
  if (error) return <p className="alert alert-error">{error}</p>
  if (!line) return <p className={styles.loading}>Carregando linha…</p>
  return <div>
    <header className={styles.pageHeader}><div><Link className="page-header__back" href="/inventory/corporate-lines">← Linhas corporativas</Link><h1>{line.number}</h1><p className={styles.subtitle}>{line.carrier || 'Operadora não informada'} · {STATUS_LABELS[line.status]}</p></div>{context.canEdit && <div className={styles.actions}><button type="button" onClick={() => setEditing(!editing)}>{editing ? 'Cancelar' : 'Editar'}</button><button type="button" onClick={() => void archive()}>Arquivar</button></div>}</header>
    {editing ? <LineFormCard form={form} setForm={setForm} people={lookups?.people ?? []} onSubmit={save} saving={saving} /> : <>
      <div className={styles.twoColumns}>
        <section className={styles.card}><h2>Plano e situação</h2><dl className={styles.definitionList}><dt>Número normalizado</dt><dd>+{line.normalizedNumber}</dd><dt>Plano</dt><dd>{line.plan || '—'}</dd><dt>Franquia</dt><dd>{line.dataAllowance || '—'}</dd><dt>SIM / eSIM</dt><dd>{line.simSlot || '—'}</dd><dt>Ativação</dt><dd>{formatDate(line.activatedAt)}</dd><dt>Suspensão</dt><dd>{formatDate(line.suspendedAt)}</dd></dl></section>
        <section className={styles.card}><h2>Vínculos atuais</h2><dl className={styles.definitionList}><dt>Colaborador</dt><dd>{line.currentHolder ? <Link href={`/inventory/people/${line.currentHolder.id}`}>{line.currentHolder.name}</Link> : 'Sem responsável'}</dd><dt>Equipamento</dt><dd>{line.equipment ? <Link href={`/inventory/equipment/${line.equipment.id}`}>{equipmentLabel(line.equipment)}</Link> : 'Sem aparelho'}</dd><dt>Observações</dt><dd>{line.notes || '—'}</dd></dl></section>
      </div>
      <section className={styles.card}><h2>Histórico</h2>{!line.history?.length ? <p className={styles.empty}>Nenhum evento.</p> : <ul className={styles.timeline}>{line.history.map((event) => <li key={event.id}><strong>{event.action}</strong><div className={styles.timelineMeta}>{event.fromHolderName || 'Sem responsável'} → {event.toHolderName || 'Sem responsável'} · {event.fromEquipmentName || 'Sem aparelho'} → {event.toEquipmentName || 'Sem aparelho'}</div><div className={styles.timelineMeta}>{formatDateTime(event.createdAt)}{event.performedByName ? ` · ${event.performedByName}` : ''}</div></li>)}</ul>}</section>
    </>}
  </div>
}

function LineFormCard({ form, setForm, people, onSubmit, saving }: { form: LineForm; setForm: (value: LineForm) => void; people: InventoryLookupsResponse['people']; onSubmit: (event: FormEvent) => void; saving: boolean }) {
  return <form className={styles.card} onSubmit={onSubmit} style={{ marginBottom: '1rem' }}><h2>Dados da linha</h2>
    <div className={styles.formGrid}>
      <Field label="Número" required><input value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} required /></Field>
      <Field label="Operadora"><input value={form.carrier} onChange={(event) => setForm({ ...form, carrier: event.target.value })} placeholder="Ex.: TIM, Vivo, Claro" /></Field>
      <Field label="Plano"><input value={form.plan} onChange={(event) => setForm({ ...form, plan: event.target.value })} /></Field>
      <Field label="Franquia de dados"><input value={form.dataAllowance} onChange={(event) => setForm({ ...form, dataAllowance: event.target.value })} placeholder="Ex.: 20 GB" /></Field>
      <Field label="Situação"><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as CorporateLineStatus })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="Colaborador"><select value={form.currentHolderId} onChange={(event) => setForm({ ...form, currentHolderId: event.target.value })}><option value="">Sem responsável</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
      <Field label="Equipamento"><EquipmentPicker value={form.equipmentId} onChange={(equipmentId) => setForm({ ...form, equipmentId })} /></Field>
      <Field label="Slot SIM / eSIM"><input value={form.simSlot} onChange={(event) => setForm({ ...form, simSlot: event.target.value })} placeholder="SIM 1, eSIM…" /></Field>
      <Field label="Ativação"><input type="date" value={form.activatedAt} onChange={(event) => setForm({ ...form, activatedAt: event.target.value })} /></Field>
      <Field label="Suspensão"><input type="date" value={form.suspendedAt} onChange={(event) => setForm({ ...form, suspendedAt: event.target.value })} /></Field>
    </div>
    <Field label="Observações"><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
    <button type="submit" className="primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar linha'}</button>
  </form>
}

function EquipmentPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { authorizedFetch } = useSession()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Array<{ id: string; patrimony: string | null; assetTag: string | null; name: string | null }>>([])
  useEffect(() => {
    if (query.trim().length < 2) { setItems([]); return }
    const timer = window.setTimeout(() => {
      void authorizedFetch(`/api/inventory/equipment?page=1&pageSize=20&q=${encodeURIComponent(query.trim())}`)
        .then(async (response) => response.ok ? response.json() : { items: [] })
        .then((data: { items?: typeof items }) => setItems(data.items ?? []))
        .catch(() => setItems([]))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [authorizedFetch, query])
  return <><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busque patrimônio, etiqueta ou nome" />
    <select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Sem aparelho vinculado</option>{value && !items.some((item) => item.id === value) && <option value={value}>Vínculo atual</option>}{items.map((item) => <option key={item.id} value={item.id}>{equipmentLabel(item)}</option>)}</select>
    <small>Pesquise e selecione o aparelho; deixe vazio para desvincular.</small></>
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return <div className={styles.field}><label>{label}{required ? ' *' : ''}</label>{children}</div>
}

'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { formatDate, readApiError } from './format'
import { InventoryGate } from './InventoryGate'
import type { InventoryContextResponse } from './types'
import styles from './inventory.module.css'

interface PageEnvelope<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}
interface Extension {
  id: string
  number: string | null
  collaborator: string | null
  department: string | null
  type: string | null
  active: boolean
  notes: string | null
}
interface Receiving {
  id: string
  receivedAt: string | null
  equipment: string | null
  quantity: number
  tag: string | null
  deliveredAt: string | null
  deliveredTo: string | null
  notes: string | null
}

export function ExtensionsPage() {
  return <InventoryGate>{(context) => <ExtensionsContent context={context} />}</InventoryGate>
}

export function ReceivingsPage() {
  return <InventoryGate>{(context) => <ReceivingsContent context={context} />}</InventoryGate>
}

type ExtTab = 'all' | 'active' | 'inactive'
const EXT_TABS: { key: ExtTab; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'active', label: 'Ativos' },
  { key: 'inactive', label: 'Sem uso / Reserva' },
]

function ExtensionsContent({ context }: { context: InventoryContextResponse }) {
  const { authorizedFetch } = useSession()
  const [data, setData] = useState<PageEnvelope<Extension> | null>(null)
  const [q, setQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [page, setPage] = useState(1)
  const [tab, setTab] = useState<ExtTab>('all')
  const [form, setForm] = useState({ number: '', collaborator: '', department: '', type: '', notes: '' })
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    number: '', collaborator: '', department: '', type: '', active: true, notes: '',
  })
  const [editSaving, setEditSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const params = new URLSearchParams({ page: String(page), pageSize: '25' })
    if (appliedQ) params.set('q', appliedQ)
    if (tab === 'active') params.set('activeFilter', 'active')
    if (tab === 'inactive') params.set('activeFilter', 'inactive')
    try {
      const response = await authorizedFetch(`/api/inventory/extensions?${params}`)
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível carregar os ramais.'))
      setData((await response.json()) as PageEnvelope<Extension>)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar os ramais.')
    }
  }, [appliedQ, authorizedFetch, page, tab])

  useEffect(() => { void load() }, [load])

  function changeTab(t: ExtTab) {
    setTab(t)
    setPage(1)
    setAppliedQ('')
    setQ('')
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const nullable = (value: string) => value.trim() || null
      const response = await authorizedFetch('/api/inventory/extensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: nullable(form.number),
          collaborator: nullable(form.collaborator),
          department: nullable(form.department),
          type: nullable(form.type),
          notes: nullable(form.notes),
          active: true,
        }),
      })
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível salvar o ramal.'))
      setForm({ number: '', collaborator: '', department: '', type: '', notes: '' })
      setShowForm(false)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao salvar o ramal.')
    } finally {
      setSaving(false)
    }
  }

  function startEdit(item: Extension) {
    setEditingId(item.id)
    setEditForm({
      number: item.number ?? '',
      collaborator: item.collaborator ?? '',
      department: item.department ?? '',
      type: item.type ?? '',
      active: item.active,
      notes: item.notes ?? '',
    })
    setShowForm(false)
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault()
    if (!editingId) return
    setEditSaving(true)
    setError(null)
    try {
      const nullable = (value: string) => value.trim() || null
      const response = await authorizedFetch(`/api/inventory/extensions/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: nullable(editForm.number),
          collaborator: nullable(editForm.collaborator),
          department: nullable(editForm.department),
          type: nullable(editForm.type),
          active: editForm.active,
          notes: nullable(editForm.notes),
        }),
      })
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível salvar o ramal.'))
      setEditingId(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao salvar o ramal.')
    } finally {
      setEditSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Excluir este ramal? Esta ação não pode ser desfeita.')) return
    setError(null)
    try {
      const response = await authorizedFetch(`/api/inventory/extensions/${id}`, { method: 'DELETE' })
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível excluir o ramal.'))
      if (editingId === id) setEditingId(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao excluir o ramal.')
    }
  }

  return (
    <div>
      <Header
        title="Ramais"
        subtitle={data ? `${data.total} ramal(is)` : 'Lista telefônica interna'}
        canEdit={context.canEdit}
        open={showForm}
        setOpen={(v) => { setShowForm(v); if (v) setEditingId(null) }}
      />
      {showForm && (
        <form className={styles.card} onSubmit={create} style={{ marginBottom: '1rem' }}>
          <div className={styles.formGrid}>
            <Field label="Número">
              <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
            </Field>
            <Field label="Colaborador">
              <input value={form.collaborator} onChange={(e) => setForm({ ...form, collaborator: e.target.value })} />
            </Field>
            <Field label="Setor">
              <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </Field>
            <Field label="Tipo">
              <input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
            </Field>
            <div className={styles.spanTwo}>
              <Field label="Observações">
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
          </div>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar ramal'}
          </button>
        </form>
      )}
      {editingId && (
        <form className={styles.card} onSubmit={saveEdit} style={{ marginBottom: '1rem' }}>
          <p style={{ margin: '0 0 0.75rem', fontWeight: 500 }}>Editar ramal</p>
          <div className={styles.formGrid}>
            <Field label="Número">
              <input value={editForm.number} onChange={(e) => setEditForm({ ...editForm, number: e.target.value })} />
            </Field>
            <Field label="Colaborador">
              <input value={editForm.collaborator} onChange={(e) => setEditForm({ ...editForm, collaborator: e.target.value })} />
            </Field>
            <Field label="Setor">
              <input value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} />
            </Field>
            <Field label="Tipo">
              <input value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} />
            </Field>
            <Field label="Situação">
              <select
                value={editForm.active ? 'true' : 'false'}
                onChange={(e) => setEditForm({ ...editForm, active: e.target.value === 'true' })}
              >
                <option value="true">Ativo</option>
                <option value="false">Sem uso / Reserva</option>
              </select>
            </Field>
            <div className={styles.spanTwo}>
              <Field label="Observações">
                <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
              </Field>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="primary" type="submit" disabled={editSaving}>
              {editSaving ? 'Salvando…' : 'Salvar alterações'}
            </button>
            <button type="button" onClick={() => setEditingId(null)}>Cancelar</button>
          </div>
        </form>
      )}
      <div className={styles.tabBar} role="tablist">
        {EXT_TABS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            className={styles.tabBtn}
            onClick={() => changeTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <Search
        value={q}
        setValue={setQ}
        onSubmit={() => { setAppliedQ(q); setPage(1) }}
      />
      {error && <p className="alert alert-error">{error}</p>}
      {!data ? (
        <p className={styles.loading}>Carregando ramais…</p>
      ) : data.items.length === 0 ? (
        <p className={`${styles.card} ${styles.empty}`}>Nenhum ramal encontrado.</p>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Ramal</th>
                  <th>Colaborador</th>
                  <th>Setor</th>
                  <th>Tipo</th>
                  <th>Situação</th>
                  {context.canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className={editingId === item.id ? styles.rowEditing : undefined}>
                    <td>{item.number || '—'}</td>
                    <td>{item.collaborator || '—'}</td>
                    <td>{item.department || '—'}</td>
                    <td>{item.type || '—'}</td>
                    <td>
                      <span className={`${styles.badge} ${item.active ? styles.success : ''}`}>
                        {item.active ? 'Ativo' : 'Sem uso'}
                      </span>
                    </td>
                    {context.canEdit && (
                      <td>
                        <div className={styles.rowActions}>
                          <button type="button" onClick={() => startEdit(item)}>Editar</button>
                          <button type="button" onClick={() => void remove(item.id)}>Excluir</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager data={data} page={page} setPage={setPage} />
        </>
      )}
    </div>
  )
}

function ReceivingsContent({ context }: { context: InventoryContextResponse }) {
  const { authorizedFetch } = useSession()
  const [data, setData] = useState<PageEnvelope<Receiving> | null>(null)
  const [q, setQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState({
    receivedAt: '',
    equipment: '',
    quantity: '1',
    tag: '',
    deliveredAt: '',
    deliveredTo: '',
    notes: '',
  })
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    const params = new URLSearchParams({ page: String(page), pageSize: '25' })
    if (appliedQ) params.set('q', appliedQ)
    try {
      const response = await authorizedFetch(`/api/inventory/receivings?${params}`)
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível carregar os recebimentos.'))
      setData((await response.json()) as PageEnvelope<Receiving>)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar os recebimentos.')
    }
  }, [appliedQ, authorizedFetch, page])
  useEffect(() => {
    void load()
  }, [load])
  async function create(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const nullable = (value: string) => value.trim() || null
      const response = await authorizedFetch('/api/inventory/receivings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivedAt: form.receivedAt || null,
          equipment: nullable(form.equipment),
          quantity: Number(form.quantity),
          tag: nullable(form.tag),
          deliveredAt: form.deliveredAt || null,
          deliveredTo: nullable(form.deliveredTo),
          notes: nullable(form.notes),
        }),
      })
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível salvar o recebimento.'))
      setForm({
        receivedAt: '',
        equipment: '',
        quantity: '1',
        tag: '',
        deliveredAt: '',
        deliveredTo: '',
        notes: '',
      })
      setShowForm(false)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao salvar o recebimento.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div>
      <Header
        title="Recebimentos"
        subtitle={data ? `${data.total} entrada(s)` : 'Entradas e entregas de equipamentos'}
        canEdit={context.canEdit}
        open={showForm}
        setOpen={setShowForm}
      />
      {showForm && (
        <form className={styles.card} onSubmit={create} style={{ marginBottom: '1rem' }}>
          <div className={styles.formGrid}>
            <Field label="Data de recebimento">
              <input
                type="date"
                value={form.receivedAt}
                onChange={(event) => setForm({ ...form, receivedAt: event.target.value })}
              />
            </Field>
            <Field label="Equipamento">
              <input
                value={form.equipment}
                onChange={(event) => setForm({ ...form, equipment: event.target.value })}
              />
            </Field>
            <Field label="Quantidade">
              <input
                type="number"
                min="1"
                value={form.quantity}
                onChange={(event) => setForm({ ...form, quantity: event.target.value })}
              />
            </Field>
            <Field label="TAG">
              <input
                value={form.tag}
                onChange={(event) => setForm({ ...form, tag: event.target.value })}
              />
            </Field>
            <Field label="Data de entrega">
              <input
                type="date"
                value={form.deliveredAt}
                onChange={(event) => setForm({ ...form, deliveredAt: event.target.value })}
              />
            </Field>
            <Field label="Entregue para">
              <input
                value={form.deliveredTo}
                onChange={(event) => setForm({ ...form, deliveredTo: event.target.value })}
              />
            </Field>
            <div className={styles.spanTwo}>
              <Field label="Observações">
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                />
              </Field>
            </div>
          </div>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar recebimento'}
          </button>
        </form>
      )}
      <Search
        value={q}
        setValue={setQ}
        onSubmit={() => {
          setAppliedQ(q)
          setPage(1)
        }}
      />
      {error && <p className="alert alert-error">{error}</p>}
      {!data ? (
        <p className={styles.loading}>Carregando recebimentos…</p>
      ) : data.items.length === 0 ? (
        <p className={`${styles.card} ${styles.empty}`}>Nenhum recebimento encontrado.</p>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Recebido em</th>
                  <th>Equipamento</th>
                  <th>Qtd.</th>
                  <th>TAG</th>
                  <th>Entregue em</th>
                  <th>Entregue para</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDate(item.receivedAt)}</td>
                    <td>{item.equipment || '—'}</td>
                    <td>{item.quantity}</td>
                    <td>{item.tag || '—'}</td>
                    <td>{formatDate(item.deliveredAt)}</td>
                    <td>{item.deliveredTo || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager data={data} page={page} setPage={setPage} />
        </>
      )}
    </div>
  )
}

function Header({
  title,
  subtitle,
  canEdit,
  open,
  setOpen,
}: {
  title: string
  subtitle: string
  canEdit: boolean
  open: boolean
  setOpen: (value: boolean) => void
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <h1>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>
      {canEdit && (
        <button type="button" className={open ? '' : 'primary'} onClick={() => setOpen(!open)}>
          {open ? 'Cancelar' : '+ Novo'}
        </button>
      )}
    </header>
  )
}
function Search({
  value,
  setValue,
  onSubmit,
}: {
  value: string
  setValue: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <form
      className={styles.filters}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className={styles.field}>
        <label>Buscar</label>
        <input value={value} onChange={(event) => setValue(event.target.value)} />
      </div>
      <button className="primary" type="submit">
        Buscar
      </button>
    </form>
  )
}
function Pager<T>({
  data,
  page,
  setPage,
}: {
  data: PageEnvelope<T>
  page: number
  setPage: (value: number) => void
}) {
  return (
    <div className={styles.pagination}>
      <span>
        Página {data.page} de {Math.max(1, data.totalPages)} · {data.total} registro(s)
      </span>
      <div className={styles.paginationActions}>
        <button type="button" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}>
          Anterior
        </button>
        <button type="button" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
          Próxima
        </button>
      </div>
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label>{label}</label>
      {children}
    </div>
  )
}

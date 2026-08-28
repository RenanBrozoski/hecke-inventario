'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { EMPLOYMENT_TYPE_LABELS, PERSON_STATUS_LABELS, readApiError } from './format'
import { InventoryGate } from './InventoryGate'
import type {
  InventoryContextResponse,
  InventoryLookupsResponse,
  PersonDetail,
  PersonStatus,
} from './types'
import styles from './inventory.module.css'

export function PersonFormPage({ personId }: { personId?: string }) {
  return (
    <InventoryGate>
      {(context) => <PersonFormContent context={context} personId={personId} />}
    </InventoryGate>
  )
}

function PersonFormContent({
  context,
  personId,
}: {
  context: InventoryContextResponse
  personId?: string
}) {
  const router = useRouter()
  const { authorizedFetch } = useSession()
  const [lookups, setLookups] = useState<InventoryLookupsResponse | null>(null)
  const [form, setForm] = useState({
    name: '',
    departmentId: '',
    title: '',
    email: '',
    cpf: '',
    employeeNumber: '',
    employmentType: '',
    status: 'ACTIVE' as PersonStatus,
    notes: '',
    bitrixUserId: '' as string | null,
  })
  const [bitrixSearch, setBitrixSearch] = useState('')
  const [bitrixResults, setBitrixResults] = useState<{ id: string; name: string; email: string }[]>([])
  const [bitrixSearching, setBitrixSearching] = useState(false)
  const [bitrixDisplayName, setBitrixDisplayName] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [lookupResponse, personResponse] = await Promise.all([
        authorizedFetch('/api/inventory/lookups'),
        personId ? authorizedFetch(`/api/inventory/people/${personId}`) : Promise.resolve(null),
      ])
      if (!lookupResponse.ok)
        throw new Error(await readApiError(lookupResponse, 'Não foi possível carregar os setores.'))
      setLookups((await lookupResponse.json()) as InventoryLookupsResponse)
      if (personResponse) {
        if (!personResponse.ok)
          throw new Error(await readApiError(personResponse, 'Colaborador não encontrado.'))
        const person = (await personResponse.json()) as PersonDetail
        setRevision(person.revision)
        setForm({
          name: person.name,
          departmentId: person.departmentId ?? person.department?.id ?? '',
          title: person.title ?? '',
          email: person.email ?? '',
          cpf: person.cpf ?? '',
          employeeNumber: person.employeeNumber ?? '',
          employmentType: person.employmentType ?? '',
          status: person.status,
          notes: person.notes ?? '',
          bitrixUserId: person.bitrixUserId ?? null,
        })
        if (person.bitrixUserId) setBitrixDisplayName(`#${person.bitrixUserId}`)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o formulário.')
    } finally {
      setLoading(false)
    }
  }, [authorizedFetch, personId])

  useEffect(() => {
    void load()
  }, [load])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const nullable = (value: string) => value.trim() || null
      const response = await authorizedFetch(
        personId ? `/api/inventory/people/${personId}` : '/api/inventory/people',
        {
          method: personId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(personId ? { revision } : {}),
            name: form.name.trim(),
            departmentId: form.departmentId || null,
            title: nullable(form.title),
            email: nullable(form.email),
            cpf: nullable(form.cpf),
            employeeNumber: nullable(form.employeeNumber),
            employmentType: form.employmentType || null,
            status: form.status,
            notes: nullable(form.notes),
            bitrixUserId: form.bitrixUserId || null,
          }),
        },
      )
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível salvar o colaborador.'))
      const saved = (await response.json()) as { id: string }
      router.push(`/inventory/people/${saved.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao salvar o colaborador.')
    } finally {
      setSaving(false)
    }
  }

  if (!context.canEdit)
    return <p className="alert alert-error">Seu acesso ao inventário é somente para consulta.</p>
  if (loading) return <p className={styles.loading}>Carregando formulário…</p>

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <Link
            className="page-header__back"
            href={personId ? `/inventory/people/${personId}` : '/inventory/people'}
          >
            ← Voltar
          </Link>
          <h1>{personId ? 'Editar colaborador' : 'Novo colaborador'}</h1>
        </div>
      </header>
      {error && <p className="alert alert-error">{error}</p>}
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.formGrid}>
          <Field label="Nome" required>
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
              maxLength={200}
            />
          </Field>
          <Field label="Setor">
            <select
              value={form.departmentId}
              onChange={(event) => setForm({ ...form, departmentId: event.target.value })}
            >
              <option value="">Sem setor</option>
              {lookups?.departments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cargo">
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              maxLength={200}
            />
          </Field>
          <Field label="E-mail">
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              maxLength={320}
            />
          </Field>
          <Field label="CPF">
            <input
              value={form.cpf}
              onChange={(event) => setForm({ ...form, cpf: event.target.value })}
              placeholder="000.000.000-00"
              maxLength={20}
            />
          </Field>
          <Field label="Matrícula">
            <input
              value={form.employeeNumber}
              onChange={(event) => setForm({ ...form, employeeNumber: event.target.value })}
              maxLength={100}
            />
          </Field>
          <Field label="Vínculo">
            <select
              value={form.employmentType}
              onChange={(event) => setForm({ ...form, employmentType: event.target.value })}
            >
              <option value="">Não informado</option>
              {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Situação">
            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value as PersonStatus })}
            >
              {Object.entries(PERSON_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Usuário Bitrix24">
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {form.bitrixUserId ? (
                <>
                  <span style={{ fontSize: '0.85rem' }}>
                    {bitrixDisplayName || `#${form.bitrixUserId}`}
                  </span>
                  <button
                    type="button"
                    style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem' }}
                    onClick={() => {
                      setForm({ ...form, bitrixUserId: null })
                      setBitrixDisplayName('')
                      setBitrixSearch('')
                      setBitrixResults([])
                    }}
                  >
                    Desvincular
                  </button>
                </>
              ) : (
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    placeholder="Buscar por nome ou e-mail…"
                    value={bitrixSearch}
                    onChange={(e) => {
                      const q = e.target.value
                      setBitrixSearch(q)
                      setBitrixResults([])
                      if (q.trim().length < 2) return
                      setBitrixSearching(true)
                      const timer = setTimeout(() => {
                        authorizedFetch(`/api/inventory/bitrix-users?q=${encodeURIComponent(q.trim())}`)
                          .then((r) => r.json())
                          .then((data: unknown) => {
                            if (Array.isArray(data)) setBitrixResults(data as { id: string; name: string; email: string }[])
                          })
                          .catch(() => undefined)
                          .finally(() => setBitrixSearching(false))
                      }, 300)
                      return () => clearTimeout(timer)
                    }}
                  />
                  {bitrixSearching && <span style={{ fontSize: '0.75rem', marginLeft: '0.5rem' }}>Buscando…</span>}
                  {bitrixResults.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, zIndex: 10, maxHeight: 200, overflowY: 'auto' }}>
                      {bitrixResults.map((u) => (
                        <div
                          key={u.id}
                          style={{ padding: '0.4rem 0.6rem', cursor: 'pointer', fontSize: '0.85rem' }}
                          onMouseDown={() => {
                            setForm({ ...form, bitrixUserId: u.id })
                            setBitrixDisplayName(`${u.name} (${u.email || '#' + u.id})`)
                            setBitrixSearch('')
                            setBitrixResults([])
                          }}
                        >
                          <strong>{u.name}</strong>
                          {u.email && <span style={{ marginLeft: '0.5rem', color: 'var(--color-text-muted)' }}>{u.email}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Field>
          <div className={styles.spanTwo}>
            <Field label="Observações">
              <textarea
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                maxLength={5000}
              />
            </Field>
          </div>
        </div>
        <div className={styles.actions} style={{ marginTop: '1rem' }}>
          <button
            className="primary"
            type="submit"
            disabled={saving || Boolean(personId && !revision)}
          >
            {saving ? 'Salvando…' : 'Salvar colaborador'}
          </button>
          <Link href={personId ? `/inventory/people/${personId}` : '/inventory/people'}>
            <button type="button">Cancelar</button>
          </Link>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={styles.field}>
      <label>
        {label}
        {required ? ' *' : ''}
      </label>
      {children}
    </div>
  )
}

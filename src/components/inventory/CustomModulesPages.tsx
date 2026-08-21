'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { FIELD_TYPE_LABELS, formatDate, formatDateTime, readApiError } from './format'
import { InventoryGate } from './InventoryGate'
import type { FieldType, InventoryContextResponse, InventoryFieldLookup } from './types'
import styles from './inventory.module.css'

interface CustomField extends InventoryFieldLookup {
  expiryAlert: boolean
  active: boolean
}
interface CustomModule {
  id: string
  name: string
  icon: string
  description: string | null
  titleLabel: string
  sortOrder: number
  active: boolean
  revision: number
  fields: CustomField[]
  _count?: { records: number }
}
interface CustomRecord {
  id: string
  title: string | null
  data: Record<string, unknown>
  revision: number
  createdAt: string
  updatedAt: string
}
interface PageEnvelope {
  items: CustomRecord[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export function CustomModulesPage() {
  return <InventoryGate>{(context) => <ModulesContent context={context} />}</InventoryGate>
}
export function CustomModuleRecordsPage({ moduleId }: { moduleId: string }) {
  return (
    <InventoryGate>
      {(context) => <RecordsContent context={context} moduleId={moduleId} />}
    </InventoryGate>
  )
}

function ModulesContent({ context }: { context: InventoryContextResponse }) {
  const { authorizedFetch } = useSession()
  const [modules, setModules] = useState<CustomModule[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '',
    icon: 'clipboard',
    description: '',
    titleLabel: 'Nome',
  })
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    const response = await authorizedFetch('/api/inventory/custom-modules')
    if (!response.ok) {
      setError(await readApiError(response, 'Não foi possível carregar os módulos.'))
      return
    }
    setModules(((await response.json()) as { items: CustomModule[] }).items)
  }, [authorizedFetch])
  useEffect(() => {
    void load()
  }, [load])
  async function create(event: FormEvent) {
    event.preventDefault()
    const response = await authorizedFetch('/api/inventory/custom-modules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        icon: form.icon,
        description: form.description.trim() || null,
        titleLabel: form.titleLabel.trim() || 'Nome',
      }),
    })
    if (!response.ok) {
      setError(await readApiError(response, 'Não foi possível criar o módulo.'))
      return
    }
    setForm({ name: '', icon: 'clipboard', description: '', titleLabel: 'Nome' })
    setShowForm(false)
    await load()
  }
  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <h1>Cadastros personalizados</h1>
          <p className={styles.subtitle}>Licenças, contratos e outros registros configuráveis.</p>
        </div>
        {context.canAdmin && (
          <button
            type="button"
            className={showForm ? '' : 'primary'}
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? 'Cancelar' : '+ Nova aba'}
          </button>
        )}
      </header>
      {error && <p className="alert alert-error">{error}</p>}
      {showForm && (
        <form className={styles.card} onSubmit={create} style={{ marginBottom: '1rem' }}>
          <div className={styles.formGrid}>
            <Field label="Nome">
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
              />
            </Field>
            <Field label="Rótulo principal">
              <input
                value={form.titleLabel}
                onChange={(event) => setForm({ ...form, titleLabel: event.target.value })}
                required
              />
            </Field>
            <Field label="Ícone">
              <input
                value={form.icon}
                onChange={(event) => setForm({ ...form, icon: event.target.value })}
              />
            </Field>
            <Field label="Descrição">
              <input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </Field>
          </div>
          <button className="primary" type="submit">
            Criar aba
          </button>
        </form>
      )}
      {!modules ? (
        <p className={styles.loading}>Carregando módulos…</p>
      ) : modules.length === 0 ? (
        <p className={`${styles.card} ${styles.empty}`}>Nenhuma aba personalizada cadastrada.</p>
      ) : (
        <div className={styles.grid}>
          {modules
            .filter((item) => item.active)
            .map((module) => (
              <Link
                key={module.id}
                href={`/inventory/custom/${module.id}`}
                className={styles.metric}
              >
                <span className={styles.metricLabel}>
                  {module.description || 'Cadastro personalizado'}
                </span>
                <strong style={{ display: 'block', marginTop: '0.4rem' }}>{module.name}</strong>
                <span className={styles.timelineMeta}>
                  {module._count?.records ?? 0} registro(s) · {module.fields.length} campo(s)
                </span>
              </Link>
            ))}
        </div>
      )}
    </div>
  )
}

function RecordsContent({
  context,
  moduleId,
}: {
  context: InventoryContextResponse
  moduleId: string
}) {
  const { authorizedFetch } = useSession()
  const [module, setModule] = useState<CustomModule | null>(null)
  const [data, setData] = useState<PageEnvelope | null>(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [fieldForm, setFieldForm] = useState({
    key: '',
    label: '',
    type: 'TEXT' as FieldType,
    options: '',
    listVisible: false,
    expiryAlert: false,
  })
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    const params = new URLSearchParams({ page: String(page), pageSize: '25' })
    if (appliedQ) params.set('q', appliedQ)
    const [moduleResponse, recordsResponse] = await Promise.all([
      authorizedFetch(`/api/inventory/custom-modules/${moduleId}`),
      authorizedFetch(`/api/inventory/custom-modules/${moduleId}/records?${params}`),
    ])
    if (!moduleResponse.ok || !recordsResponse.ok) {
      setError(
        await readApiError(
          !moduleResponse.ok ? moduleResponse : recordsResponse,
          'Não foi possível carregar o cadastro.',
        ),
      )
      return
    }
    setModule((await moduleResponse.json()) as CustomModule)
    setData((await recordsResponse.json()) as PageEnvelope)
  }, [appliedQ, authorizedFetch, moduleId, page])
  useEffect(() => {
    void load()
  }, [load])
  async function createRecord(event: FormEvent) {
    event.preventDefault()
    if (!module) return
    const normalized: Record<string, unknown> = {}
    for (const field of module.fields) {
      const value = values[field.key]
      if (field.type === 'BOOLEAN' && (value === undefined || value === '')) {
        if (field.required) normalized[field.key] = false
        continue
      }
      if (value === undefined || value === '') continue
      normalized[field.key] =
        field.type === 'NUMBER' ? Number(value) : field.type === 'BOOLEAN' ? Boolean(value) : value
    }
    const response = await authorizedFetch(`/api/inventory/custom-modules/${moduleId}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim() || null, data: normalized }),
    })
    if (!response.ok) {
      setError(await readApiError(response, 'Não foi possível criar o registro.'))
      return
    }
    setTitle('')
    setValues({})
    setShowForm(false)
    await load()
  }
  async function createField(event: FormEvent) {
    event.preventDefault()
    const response = await authorizedFetch(`/api/inventory/custom-modules/${moduleId}/fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: fieldForm.key,
        label: fieldForm.label,
        type: fieldForm.type,
        options:
          fieldForm.type === 'SELECT'
            ? fieldForm.options
                .split(';')
                .map((value) => value.trim())
                .filter(Boolean)
            : [],
        listVisible: fieldForm.listVisible,
        expiryAlert: fieldForm.expiryAlert,
      }),
    })
    if (!response.ok) {
      setError(await readApiError(response, 'Não foi possível criar o campo.'))
      return
    }
    setFieldForm({
      key: '',
      label: '',
      type: 'TEXT',
      options: '',
      listVisible: false,
      expiryAlert: false,
    })
    await load()
  }
  if (!module || !data)
    return (
      <div>
        {error && <p className="alert alert-error">{error}</p>}
        <p className={styles.loading}>Carregando cadastro…</p>
      </div>
    )
  const visibleFields = module.fields.filter(
    (field) => field.active && field.listVisible && field.type !== 'PASSWORD',
  )
  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <Link className="page-header__back" href="/inventory/custom">
            ← Personalizados
          </Link>
          <h1>{module.name}</h1>
          <p className={styles.subtitle}>{module.description || `${data.total} registro(s)`}</p>
        </div>
        {context.canEdit && (
          <button
            type="button"
            className={showForm ? '' : 'primary'}
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? 'Cancelar' : '+ Novo registro'}
          </button>
        )}
      </header>
      {error && <p className="alert alert-error">{error}</p>}
      {showForm && (
        <form className={styles.card} onSubmit={createRecord} style={{ marginBottom: '1rem' }}>
          <h2>Novo registro</h2>
          <div className={styles.formGrid}>
            <Field label={module.titleLabel}>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            {module.fields
              .filter((field) => field.active && field.type !== 'PASSWORD')
              .map((field) => (
                <DynamicInput
                  key={field.id}
                  field={field}
                  value={values[field.key]}
                  onChange={(value) => setValues({ ...values, [field.key]: value })}
                />
              ))}
          </div>
          <button className="primary" type="submit">
            Salvar registro
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
          <input value={q} onChange={(event) => setQ(event.target.value)} />
        </div>
        <button className="primary" type="submit">
          Buscar
        </button>
      </form>
      {data.items.length === 0 ? (
        <p className={`${styles.card} ${styles.empty}`}>Nenhum registro encontrado.</p>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>{module.titleLabel}</th>
                  {visibleFields.map((field) => (
                    <th key={field.id}>{field.label}</th>
                  ))}
                  <th>Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((record) => (
                  <tr key={record.id}>
                    <td>{record.title || '—'}</td>
                    {visibleFields.map((field) => (
                      <td key={field.id}>{formatValue(record.data[field.key], field)}</td>
                    ))}
                    <td>{formatDateTime(record.updatedAt)}</td>
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
      {context.canAdmin && (
        <form className={`${styles.card} ${styles.sectionTitle}`} onSubmit={createField}>
          <h2>Adicionar campo</h2>
          <div className={styles.formGrid}>
            <Field label="Chave">
              <input
                value={fieldForm.key}
                onChange={(event) =>
                  setFieldForm({
                    ...fieldForm,
                    key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                  })
                }
                required
              />
            </Field>
            <Field label="Rótulo">
              <input
                value={fieldForm.label}
                onChange={(event) => setFieldForm({ ...fieldForm, label: event.target.value })}
                required
              />
            </Field>
            <Field label="Tipo">
              <select
                value={fieldForm.type}
                onChange={(event) =>
                  setFieldForm({ ...fieldForm, type: event.target.value as FieldType })
                }
              >
                {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {fieldForm.type === 'SELECT' && (
              <Field label="Opções (;)">
                <input
                  value={fieldForm.options}
                  onChange={(event) => setFieldForm({ ...fieldForm, options: event.target.value })}
                />
              </Field>
            )}
            <label>
              <input
                type="checkbox"
                checked={fieldForm.listVisible}
                onChange={(event) =>
                  setFieldForm({ ...fieldForm, listVisible: event.target.checked })
                }
              />{' '}
              Mostrar na lista
            </label>
            <label>
              <input
                type="checkbox"
                checked={fieldForm.expiryAlert}
                onChange={(event) =>
                  setFieldForm({ ...fieldForm, expiryAlert: event.target.checked })
                }
              />{' '}
              Alertar vencimento
            </label>
          </div>
          <button type="submit" className="primary">
            Adicionar campo
          </button>
        </form>
      )}
    </div>
  )
}

function DynamicInput({
  field,
  value,
  onChange,
}: {
  field: CustomField
  value: unknown
  onChange: (value: unknown) => void
}) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  if (field.type === 'BOOLEAN')
    return (
      <label>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />{' '}
        {field.label}
      </label>
    )
  if (field.type === 'TEXTAREA')
    return (
      <Field label={field.label}>
        <textarea
          value={text}
          onChange={(event) => onChange(event.target.value)}
          required={field.required}
        />
      </Field>
    )
  if (field.type === 'SELECT')
    return (
      <Field label={field.label}>
        <select
          value={text}
          onChange={(event) => onChange(event.target.value)}
          required={field.required}
        >
          <option value="">Selecione…</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>
    )
  return (
    <Field label={field.label}>
      <input
        type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
      />
    </Field>
  )
}
function formatValue(value: unknown, field: CustomField): string {
  if (value === null || value === undefined || value === '') return '—'
  if (field.type === 'BOOLEAN') return value ? 'Sim' : 'Não'
  if (field.type === 'DATE') return formatDate(String(value))
  return String(value)
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label>{label}</label>
      {children}
    </div>
  )
}

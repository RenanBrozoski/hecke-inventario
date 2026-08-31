'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { FIELD_TYPE_LABELS, readApiError } from './format'
import { InventoryGate, useInventoryContext } from './InventoryGate'
import type {
  FieldType,
  InventoryFieldLookup,
  InventoryRole,
  NamedLookup,
} from './types'
import styles from './inventory.module.css'

interface Category extends NamedLookup {
  prefix?: string | null
  icon?: string
  active: boolean
  revision: number
  fields: InventoryFieldLookup[]
  _count?: { equipment: number }
}
interface RoleAssignment {
  id: string
  bitrixUserId: string
  role: InventoryRole
  user: { fullName: string; email?: string | null; active: boolean } | null
}
interface BitrixUser {
  bitrixUserId: string
  fullName: string
  email?: string | null
  position?: string | null
}
interface ManagedLookup extends NamedLookup {
  active: boolean
  _count?: { equipment?: number; people?: number }
}
type Section = 'categories' | 'departments' | 'locations' | 'access'

export function InventorySettingsPage() {
  return <InventoryGate><SettingsContent /></InventoryGate>
}

function SettingsContent() {
  const context = useInventoryContext()
  const { authorizedFetch } = useSession()
  const [section, setSection] = useState<Section>('categories')
  const [categories, setCategories] = useState<Category[]>([])
  const [departments, setDepartments] = useState<ManagedLookup[]>([])
  const [locations, setLocations] = useState<ManagedLookup[]>([])
  const [assignments, setAssignments] = useState<RoleAssignment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [catRes, depRes, locRes, roleRes] = await Promise.all([
        authorizedFetch('/api/inventory/categories'),
        authorizedFetch('/api/inventory/departments'),
        authorizedFetch('/api/inventory/locations'),
        authorizedFetch('/api/inventory/role-assignments'),
      ])
      for (const response of [catRes, depRes, locRes, roleRes])
        if (!response.ok)
          throw new Error(await readApiError(response, 'Não foi possível carregar a configuração.'))
      setCategories(((await catRes.json()) as { items: Category[] }).items)
      setDepartments(((await depRes.json()) as { items: ManagedLookup[] }).items)
      setLocations(((await locRes.json()) as { items: ManagedLookup[] }).items)
      setAssignments(((await roleRes.json()) as { items: RoleAssignment[] }).items)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar a configuração.')
    } finally {
      setLoading(false)
    }
  }, [authorizedFetch])
  useEffect(() => {
    if (context.canAdmin) void load()
  }, [context.canAdmin, load])
  if (!context.canAdmin)
    return (
      <p className="alert alert-error">Somente administradores podem configurar o inventário.</p>
    )
  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <h1>Configuração do inventário</h1>
          <p className={styles.subtitle}>Categorias, campos, setores, locais e acesso.</p>
        </div>
      </header>
      <div className={styles.moduleNav} style={{ marginBottom: '1rem' }}>
        {(
          [
            ['categories', 'Categorias e campos'],
            ['departments', 'Setores'],
            ['locations', 'Locais'],
            ['access', 'Acesso'],
          ] as Array<[Section, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={section === id ? 'primary' : ''}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      {loading ? (
        <p className={styles.loading}>Carregando configuração…</p>
      ) : (
        <>
          {section === 'categories' && <CategoriesSettings categories={categories} reload={load} />}
          {section === 'departments' && (
            <NamedSettings
              title="Setores"
              endpoint="departments"
              items={departments}
              reload={load}
            />
          )}
          {section === 'locations' && (
            <NamedSettings
              title="Locais / filiais"
              endpoint="locations"
              items={locations}
              reload={load}
            />
          )}
          {section === 'access' && <AccessSettings assignments={assignments} reload={load} />}
        </>
      )}
    </div>
  )
}

function CategoriesSettings({
  categories,
  reload,
}: {
  categories: Category[]
  reload: () => Promise<void>
}) {
  const { authorizedFetch } = useSession()
  const [selectedId, setSelectedId] = useState(categories[0]?.id ?? '')
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [categoryPrefix, setCategoryPrefix] = useState('')
  const [field, setField] = useState({
    key: '',
    label: '',
    type: 'TEXT' as FieldType,
    options: '',
    required: false,
    listVisible: false,
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const selected = categories.find((item) => item.id === selectedId) ?? categories[0]
  useEffect(() => {
    if (!selectedId && categories[0]) setSelectedId(categories[0].id)
  }, [categories, selectedId])
  useEffect(() => {
    setCategoryName(selected?.name ?? '')
    setCategoryPrefix(selected?.prefix ?? '')
  }, [selected?.id, selected?.name, selected?.prefix])
  async function createCategory(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const response = await authorizedFetch('/api/inventory/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          prefix: prefix.trim() || null,
          icon: 'box-seam',
        }),
      })
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível criar a categoria.'))
      setName('')
      setPrefix('')
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao criar a categoria.')
    } finally {
      setSaving(false)
    }
  }
  async function createField(event: FormEvent) {
    event.preventDefault()
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      const response = await authorizedFetch(`/api/inventory/categories/${selected.id}/fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: field.key.trim(),
          label: field.label.trim(),
          type: field.type,
          options:
            field.type === 'SELECT'
              ? field.options
                  .split(';')
                  .map((value) => value.trim())
                  .filter(Boolean)
              : [],
          required: field.required,
          listVisible: field.listVisible,
        }),
      })
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível criar o campo.'))
      setField({
        key: '',
        label: '',
        type: 'TEXT',
        options: '',
        required: false,
        listVisible: false,
      })
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao criar o campo.')
    } finally {
      setSaving(false)
    }
  }
  async function updateSelectedCategory(event: FormEvent) {
    event.preventDefault()
    if (!selected) return
    setSaving(true); setError(null)
    try {
      const response = await authorizedFetch(`/api/inventory/categories/${selected.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: selected.revision, name: categoryName.trim(), prefix: categoryPrefix.trim() || null }),
      })
      if (!response.ok) throw new Error(await readApiError(response, 'Não foi possível atualizar a categoria.'))
      await reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao atualizar a categoria.') } finally { setSaving(false) }
  }
  async function deactivateSelectedCategory() {
    if (!selected || !window.confirm(`Remover “${selected.name}” da lista? A categoria será inativada e os dados serão preservados.`)) return
    setSaving(true); setError(null)
    try {
      const response = await authorizedFetch(`/api/inventory/categories/${selected.id}?revision=${selected.revision}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiError(response, 'Não foi possível inativar a categoria.'))
      await reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao inativar a categoria.') } finally { setSaving(false) }
  }
  return (
    <div>
      {error && <p className="alert alert-error">{error}</p>}
      <div className={styles.twoColumns}>
        <section className={styles.card}>
          <h2>Categorias</h2>
          <form onSubmit={createCategory}>
            <div className={styles.formGrid}>
              <Field label="Nome">
                <input value={name} onChange={(event) => setName(event.target.value)} required />
              </Field>
              <Field label="Prefixo">
                <input
                  value={prefix}
                  onChange={(event) => setPrefix(event.target.value)}
                  maxLength={30}
                />
              </Field>
            </div>
            <button type="submit" className="primary" disabled={saving}>
              Adicionar categoria
            </button>
          </form>
          <div className={styles.sectionTitle}>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={selected?.id === category.id ? 'primary' : ''}
                onClick={() => setSelectedId(category.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  marginBottom: '0.35rem',
                }}
              >
                {category.name}{' '}
                <span className={styles.timelineMeta}>
                  ({category._count?.equipment ?? 0} equipamentos)
                </span>
              </button>
            ))}
          </div>
          {selected && (
            <form className={styles.sectionTitle} onSubmit={updateSelectedCategory}>
              <h3>Editar categoria selecionada</h3>
              <div className={styles.formGrid}>
                <Field label="Nome"><input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} required /></Field>
                <Field label="Prefixo"><input value={categoryPrefix} onChange={(event) => setCategoryPrefix(event.target.value)} maxLength={30} /></Field>
              </div>
              <div className={styles.actions}>
                <button type="submit" className="primary" disabled={saving}>Salvar categoria</button>
                {selected.active && <button type="button" disabled={saving} onClick={() => void deactivateSelectedCategory()}>Inativar / remover</button>}
              </div>
            </form>
          )}
        </section>
        <section className={styles.card}>
          <h2>{selected ? `Campos · ${selected.name}` : 'Campos'}</h2>
          {selected && (
            <>
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Rótulo</th>
                      <th>Chave</th>
                      <th>Tipo</th>
                      <th>Lista</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.fields.map((item) => (
                      <tr key={item.id}>
                        <td>{item.label}</td>
                        <td>
                          <code>{item.key}</code>
                        </td>
                        <td>{FIELD_TYPE_LABELS[item.type]}</td>
                        <td>{item.listVisible ? 'Sim' : 'Não'}</td>
                        <td>
                          {item.active !== false ? (
                            <button type="button" onClick={() => void deactivateField(item.id, item.label)}>
                              Remover
                            </button>
                          ) : (
                            <span className={styles.muted}>Removido</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <form className={styles.sectionTitle} onSubmit={createField}>
                <h3>Novo campo</h3>
                <div className={styles.formGrid}>
                  <Field label="Chave">
                    <input
                      value={field.key}
                      onChange={(event) =>
                        setField({
                          ...field,
                          key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                        })
                      }
                      required
                      placeholder="ex.: modelo"
                    />
                  </Field>
                  <Field label="Rótulo">
                    <input
                      value={field.label}
                      onChange={(event) => setField({ ...field, label: event.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Tipo">
                    <select
                      value={field.type}
                      onChange={(event) =>
                        setField({ ...field, type: event.target.value as FieldType })
                      }
                    >
                      {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {field.type === 'SELECT' && (
                    <Field label="Opções (separadas por ;)">
                      <input
                        value={field.options}
                        onChange={(event) => setField({ ...field, options: event.target.value })}
                      />
                    </Field>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) => setField({ ...field, required: event.target.checked })}
                    />{' '}
                    Obrigatório
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={field.listVisible}
                      onChange={(event) =>
                        setField({ ...field, listVisible: event.target.checked })
                      }
                    />{' '}
                    Mostrar na lista
                  </label>
                </div>
                <button type="submit" className="primary" disabled={saving}>
                  Adicionar campo
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  )

  async function deactivateField(fieldId: string, label: string) {
    if (!selected || !window.confirm(`Remover o campo “${label}”? Os dados já salvos serão preservados.`)) return
    setSaving(true); setError(null)
    try {
      const response = await authorizedFetch(`/api/inventory/categories/${selected.id}/fields/${fieldId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiError(response, 'Não foi possível remover o campo.'))
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao remover o campo.')
    } finally { setSaving(false) }
  }
}

function NamedSettings({
  title,
  endpoint,
  items,
  reload,
}: {
  title: string
  endpoint: 'departments' | 'locations'
  items: ManagedLookup[]
  reload: () => Promise<void>
}) {
  const { authorizedFetch } = useSession()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [editing, setEditing] = useState<ManagedLookup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR')
    if (!normalized) return items
    return items.filter((item) =>
      `${item.name} ${item.description ?? ''}`.toLocaleLowerCase('pt-BR').includes(normalized),
    )
  }, [items, query])
  const isDepartment = endpoint === 'departments'
  const linkedCount = (item: ManagedLookup) =>
    (item._count?.equipment ?? 0) + (isDepartment ? (item._count?.people ?? 0) : 0)
  const equipmentHref = (item: ManagedLookup) =>
    `/inventory/equipment?${isDepartment ? 'departmentId' : 'locationId'}=${encodeURIComponent(item.id)}`
  async function create(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const response = await authorizedFetch(`/api/inventory/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      })
      if (!response.ok)
        throw new Error(await readApiError(response, `Não foi possível criar o registro.`))
      setName('')
      setDescription('')
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao criar o registro.')
    } finally {
      setSaving(false)
    }
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      const response = await authorizedFetch(`/api/inventory/${endpoint}/${editing.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, active: editing.active }),
      })
      if (!response.ok) throw new Error(await readApiError(response, 'Não foi possível atualizar o registro.'))
      setEditing(null); setName(''); setDescription(''); await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao atualizar o registro.')
    } finally {
      setSaving(false)
    }
  }
  async function toggleActive(item: ManagedLookup) {
    const action = item.active ? 'desativar' : 'ativar'
    if (!window.confirm(`${action[0]!.toUpperCase()}${action.slice(1)} “${item.name}”?`)) return
    setSaving(true)
    setError(null)
    try {
      const response = await authorizedFetch(`/api/inventory/${endpoint}/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !item.active }),
      })
      if (!response.ok) throw new Error(await readApiError(response, `Não foi possível ${action} o registro.`))
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Falha ao ${action} o registro.`)
    } finally {
      setSaving(false)
    }
  }
  async function permanentlyDelete(item: ManagedLookup) {
    if (linkedCount(item) > 0) {
      setError('Este cadastro possui vínculos. Mova os registros e use a inativação para preservar o histórico.')
      return
    }
    if (!window.confirm(`Excluir definitivamente “${item.name}”? Esta ação não pode ser desfeita.`)) return
    setSaving(true)
    setError(null)
    try {
      const response = await authorizedFetch(`/api/inventory/${endpoint}/${item.id}?permanent=true`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await readApiError(response, 'Não foi possível excluir o registro.'))
      if (editing?.id === item.id) {
        setEditing(null)
        setName('')
        setDescription('')
      }
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao excluir o registro.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className={styles.card}>
      <h2>{title}</h2>
      <p className={styles.notice}>
        {isDepartment
          ? 'Setores organizam pessoas e equipamentos. Cadastros com histórico devem ser inativados.'
          : 'Locais/filiais organizam os equipamentos. Cadastros com vínculos devem ser inativados.'}
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      <form className={styles.formGrid} onSubmit={editing ? saveEdit : create}>
        <Field label="Nome">
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field label="Descrição">
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <button type="submit" className="primary" disabled={saving}>
          {editing ? 'Salvar alterações' : 'Adicionar'}
        </button>
        {editing && <button type="button" disabled={saving} onClick={() => { setEditing(null); setName(''); setDescription('') }}>Cancelar</button>}
      </form>
      <div className={`${styles.filters} ${styles.sectionTitle}`}>
        <div className={styles.field}>
          <label htmlFor={`${endpoint}-search`}>Buscar</label>
          <input
            id={`${endpoint}-search`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Buscar ${title.toLocaleLowerCase('pt-BR')}…`}
          />
        </div>
        <p className={styles.notice}>
          {filteredItems.length} de {items.length} cadastro(s)
        </p>
      </div>
      <div className={`${styles.tableWrap} ${styles.sectionTitle}`}>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Descrição</th>
              <th>Vínculos</th>
              <th>Situação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.description || '—'}</td>
                <td>
                  <a href={equipmentHref(item)}>
                    {item._count?.equipment ?? 0} equipamento(s)
                  </a>
                  {isDepartment && <><br />{item._count?.people ?? 0} pessoa(s)</>}
                </td>
                <td><span className={item.active ? 'badge badge-success' : 'badge'}>{item.active ? 'Ativo' : 'Inativo'}</span></td>
                <td className={styles.rowActions}>
                  <button type="button" disabled={saving} onClick={() => { setEditing(item); setName(item.name); setDescription(item.description ?? '') }}>Editar</button>
                  <button type="button" disabled={saving} onClick={() => void toggleActive(item)}>{item.active ? 'Inativar' : 'Ativar'}</button>
                  <button type="button" className="danger" disabled={saving || linkedCount(item) > 0} onClick={() => void permanentlyDelete(item)} title={linkedCount(item) > 0 ? 'Mova os vínculos antes de excluir definitivamente.' : 'Excluir definitivamente'}>Excluir</button>
                </td>
              </tr>
            ))}
            {filteredItems.length === 0 && <tr><td colSpan={5} className={styles.muted}>Nenhum cadastro encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function AccessSettings({
  assignments,
  reload,
}: {
  assignments: RoleAssignment[]
  reload: () => Promise<void>
}) {
  const { authorizedFetch } = useSession()
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState<BitrixUser[]>([])
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<InventoryRole>('VIEWER')
  const [error, setError] = useState<string | null>(null)
  async function searchUsers(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const response = await authorizedFetch(
      `/api/bitrix/users?search=${encodeURIComponent(search)}&pageSize=50`,
    )
    if (!response.ok) {
      setError(await readApiError(response, 'Não foi possível buscar usuários.'))
      return
    }
    setUsers(((await response.json()) as { items: BitrixUser[] }).items)
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const response = await authorizedFetch('/api/inventory/role-assignments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bitrixUserId: userId, role }),
    })
    if (!response.ok) {
      setError(await readApiError(response, 'Não foi possível definir o acesso.'))
      return
    }
    setUserId('')
    await reload()
  }
  async function remove(bitrixUserId: string) {
    const response = await authorizedFetch(
      `/api/inventory/role-assignments/${encodeURIComponent(bitrixUserId)}`,
      { method: 'DELETE' },
    )
    if (!response.ok) {
      setError(await readApiError(response, 'Não foi possível remover o acesso.'))
      return
    }
    await reload()
  }
  return (
    <section className={styles.card}>
      <h2>Acesso ao inventário</h2>
      <p className={styles.notice}>
        Sem atribuição, o usuário não acessa o módulo. Administradores do portal sempre administram
        o inventário.
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      <form className={styles.filters} onSubmit={searchUsers}>
        <div className={styles.field}>
          <label>Buscar usuário Bitrix</label>
          <input value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <button type="submit">Buscar</button>
      </form>
      {users.length > 0 && (
        <form className={styles.formGrid} onSubmit={save}>
          <Field label="Usuário">
            <select value={userId} onChange={(event) => setUserId(event.target.value)} required>
              <option value="">Selecione…</option>
              {users.map((user) => (
                <option key={user.bitrixUserId} value={user.bitrixUserId}>
                  {user.fullName}
                  {user.email ? ` · ${user.email}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Papel">
            <select value={role} onChange={(event) => setRole(event.target.value as InventoryRole)}>
              <option value="VIEWER">Consulta</option>
              <option value="OPERATOR">Suporte</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </Field>
          <button type="submit" className="primary">
            Salvar acesso
          </button>
        </form>
      )}
      <div className={`${styles.tableWrap} ${styles.sectionTitle}`}>
        <table>
          <thead>
            <tr>
              <th>Usuário</th>
              <th>Papel</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((assignment) => (
              <tr key={assignment.id}>
                <td>{assignment.user?.fullName ?? `Usuário #${assignment.bitrixUserId}`}</td>
                <td>
                  {assignment.role === 'ADMIN'
                    ? 'Administrador'
                    : assignment.role === 'OPERATOR'
                      ? 'Suporte'
                      : 'Consulta'}
                </td>
                <td>
                  <button type="button" onClick={() => void remove(assignment.bitrixUserId)}>
                    Revogar acesso
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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

'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { EQUIPMENT_STATUS_LABELS, readApiError } from './format'
import { InventoryGate } from './InventoryGate'
import type {
  EquipmentDetail,
  InventoryContextResponse,
  InventoryFieldLookup,
  InventoryLookupsResponse,
  EquipmentCodeSuggestion,
} from './types'
import styles from './inventory.module.css'

interface EquipmentFormPageProps {
  equipmentId?: string
}

interface FormState {
  patrimony: string
  assetTag: string
  name: string
  categoryId: string
  status: keyof typeof EQUIPMENT_STATUS_LABELS
  currentHolderId: string
  departmentId: string
  locationId: string
  locationDetail: string
  serialNumber: string
  invoiceNumber: string
  acquiredAt: string
  receivedAt: string
  deliveredAt: string
  warrantyEndsAt: string
  notes: string
}

const INITIAL_FORM: FormState = {
  patrimony: '',
  assetTag: '',
  name: '',
  categoryId: '',
  status: 'ACTIVE',
  currentHolderId: '',
  departmentId: '',
  locationId: '',
  locationDetail: '',
  serialNumber: '',
  invoiceNumber: '',
  acquiredAt: '',
  receivedAt: '',
  deliveredAt: '',
  warrantyEndsAt: '',
  notes: '',
}

export function EquipmentFormPage({ equipmentId }: EquipmentFormPageProps) {
  return (
    <InventoryGate>
      {(context) => <EquipmentFormContent context={context} equipmentId={equipmentId} />}
    </InventoryGate>
  )
}

function EquipmentFormContent({
  context,
  equipmentId,
}: {
  context: InventoryContextResponse
  equipmentId?: string
}) {
  const router = useRouter()
  const { authorizedFetch } = useSession()
  const [lookups, setLookups] = useState<InventoryLookupsResponse | null>(null)
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [specs, setSpecs] = useState<Record<string, unknown>>({})
  const [revision, setRevision] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [codeSuggestion, setCodeSuggestion] = useState<EquipmentCodeSuggestion | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [lookupResponse, equipmentResponse] = await Promise.all([
        authorizedFetch('/api/inventory/lookups'),
        equipmentId
          ? authorizedFetch(`/api/inventory/equipment/${equipmentId}`)
          : Promise.resolve(null),
      ])
      if (!lookupResponse.ok)
        throw new Error(
          await readApiError(lookupResponse, 'Não foi possível carregar os cadastros auxiliares.'),
        )
      setLookups((await lookupResponse.json()) as InventoryLookupsResponse)

      if (equipmentResponse) {
        if (!equipmentResponse.ok)
          throw new Error(await readApiError(equipmentResponse, 'Equipamento não encontrado.'))
        const item = (await equipmentResponse.json()) as EquipmentDetail
        setRevision(item.revision)
        setSpecs(item.specs ?? {})
        setForm({
          patrimony: item.patrimony ?? '',
          assetTag: item.assetTag ?? '',
          name: item.name ?? '',
          categoryId: item.categoryId ?? item.category.id,
          status: item.status,
          currentHolderId: item.currentHolderId ?? item.currentHolder?.id ?? '',
          departmentId: item.departmentId ?? item.department?.id ?? '',
          locationId: item.locationId ?? item.location?.id ?? '',
          locationDetail: item.locationDetail ?? '',
          serialNumber: item.serialNumber ?? '',
          invoiceNumber: item.invoiceNumber ?? '',
          acquiredAt: item.acquiredAt?.slice(0, 10) ?? '',
          receivedAt: item.receivedAt?.slice(0, 10) ?? '',
          deliveredAt: item.deliveredAt?.slice(0, 10) ?? '',
          warrantyEndsAt: item.warrantyEndsAt?.slice(0, 10) ?? '',
          notes: item.notes ?? '',
        })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o formulário.')
    } finally {
      setLoading(false)
    }
  }, [authorizedFetch, equipmentId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (equipmentId || !form.categoryId) { setCodeSuggestion(null); return }
    let cancelled = false
    void authorizedFetch(`/api/inventory/equipment/code-suggestion?categoryId=${encodeURIComponent(form.categoryId)}`)
      .then(async (response) => response.ok ? response.json() as Promise<EquipmentCodeSuggestion> : null)
      .then((value) => { if (!cancelled) setCodeSuggestion(value) })
      .catch(() => { if (!cancelled) setCodeSuggestion(null) })
    return () => { cancelled = true }
  }, [authorizedFetch, equipmentId, form.categoryId])

  const selectedCategory = useMemo(
    () => lookups?.categories.find((category) => category.id === form.categoryId) ?? null,
    [form.categoryId, lookups],
  )

  function selectHolder(currentHolderId: string) {
    const holder = lookups?.people.find((person) => person.id === currentHolderId)
    setForm((current) => ({
      ...current,
      currentHolderId,
      // A escolha ainda pode ser ajustada manualmente, mas a associação de um
      // colaborador sincronizado já sugere o setor correto sem retrabalho.
      departmentId: holder?.departmentId ?? current.departmentId,
    }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!form.categoryId) {
      setError('Selecione uma categoria.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const nullable = (value: string) => value.trim() || null
      const payload = {
        ...(equipmentId ? { revision } : {}),
        patrimony: nullable(form.patrimony),
        assetTag: nullable(form.assetTag),
        name: nullable(form.name),
        categoryId: form.categoryId,
        status: form.status,
        currentHolderId: form.currentHolderId || null,
        departmentId: form.departmentId || null,
        locationId: form.locationId || null,
        locationDetail: nullable(form.locationDetail),
        serialNumber: nullable(form.serialNumber),
        invoiceNumber: nullable(form.invoiceNumber),
        acquiredAt: form.acquiredAt || null,
        receivedAt: form.receivedAt || null,
        deliveredAt: form.deliveredAt || null,
        warrantyEndsAt: form.warrantyEndsAt || null,
        specs: normalizeSpecs(specs, selectedCategory?.fields ?? []),
        notes: nullable(form.notes),
      }
      const response = await authorizedFetch(
        equipmentId ? `/api/inventory/equipment/${equipmentId}` : '/api/inventory/equipment',
        {
          method: equipmentId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível salvar o equipamento.'))
      const saved = (await response.json()) as { id: string }
      router.push(`/inventory/equipment/${saved.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao salvar o equipamento.')
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
            href={equipmentId ? `/inventory/equipment/${equipmentId}` : '/inventory/equipment'}
          >
            ← Voltar
          </Link>
          <h1>{equipmentId ? 'Editar equipamento' : 'Novo equipamento'}</h1>
        </div>
      </header>
      {error && <p className="alert alert-error">{error}</p>}
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.formGrid}>
          <Field label="Categoria" required>
            <select
              value={form.categoryId}
              onChange={(event) => {
                setForm({ ...form, categoryId: event.target.value })
                setSpecs({})
              }}
              required
            >
              <option value="">Selecione…</option>
              {lookups?.categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Situação">
            <select
              value={form.status}
              onChange={(event) =>
                setForm({ ...form, status: event.target.value as FormState['status'] })
              }
            >
              {Object.entries(EQUIPMENT_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Código interno (TI)">
            <input
              value={form.patrimony}
              onChange={(event) => setForm({ ...form, patrimony: event.target.value })}
              maxLength={100}
            />
            {codeSuggestion?.suggestedCode && (
              <div className={styles.codeSuggestion}>
                <span>Último código: <strong>{codeSuggestion.lastCode ?? 'nenhum'}</strong> · sugestão: <strong>{codeSuggestion.suggestedCode}</strong></span>
                <button type="button" onClick={() => setForm({ ...form, patrimony: codeSuggestion.suggestedCode! })}>Usar sugestão</button>
              </div>
            )}
          </Field>
          <Field label="TAG patrimonial">
            <input
              value={form.assetTag}
              onChange={(event) => setForm({ ...form, assetTag: event.target.value })}
              maxLength={100}
            />
          </Field>
          <Field label="Nome / descrição">
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              maxLength={200}
            />
          </Field>
          <Field label="Número de série">
            <input
              value={form.serialNumber}
              onChange={(event) => setForm({ ...form, serialNumber: event.target.value })}
              maxLength={200}
            />
          </Field>
          <Field label="Responsável">
            <select
              value={form.currentHolderId}
              onChange={(event) => selectHolder(event.target.value)}
            >
              <option value="">Estoque / sem responsável</option>
              {lookups?.people.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
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
            <p className={styles.notice}>Preenchido automaticamente conforme o responsável, quando disponível.</p>
          </Field>
          <Field label="Local / filial">
            <select
              value={form.locationId}
              onChange={(event) => setForm({ ...form, locationId: event.target.value })}
            >
              <option value="">Sem local</option>
              {lookups?.locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Detalhe do local">
            <input
              value={form.locationDetail}
              onChange={(event) => setForm({ ...form, locationDetail: event.target.value })}
              maxLength={500}
            />
          </Field>
          <Field label="Nota fiscal">
            <input
              value={form.invoiceNumber}
              onChange={(event) => setForm({ ...form, invoiceNumber: event.target.value })}
              maxLength={200}
            />
          </Field>
          <Field label="Data de aquisição">
            <input
              type="date"
              value={form.acquiredAt}
              onChange={(event) => setForm({ ...form, acquiredAt: event.target.value })}
            />
          </Field>
          <Field label="Data de recebimento">
            <input
              type="date"
              value={form.receivedAt}
              onChange={(event) => setForm({ ...form, receivedAt: event.target.value })}
            />
          </Field>
          <Field label="Data de entrega">
            <input
              type="date"
              value={form.deliveredAt}
              onChange={(event) => setForm({ ...form, deliveredAt: event.target.value })}
            />
          </Field>
          <Field label="Fim da garantia">
            <input
              type="date"
              value={form.warrantyEndsAt}
              onChange={(event) => setForm({ ...form, warrantyEndsAt: event.target.value })}
            />
          </Field>
        </div>

        {selectedCategory && (selectedCategory.fields?.length ?? 0) > 0 && (
          <>
            <h2 className={styles.sectionTitle}>Especificações · {selectedCategory.name}</h2>
            <div className={styles.formGrid}>
              {selectedCategory.fields?.map((field) => (
                <SpecField
                  key={field.id}
                  field={field}
                  value={specs[field.key]}
                  onChange={(value) =>
                    setSpecs((current) => {
                      const next = { ...current }
                      if (value === '' || value === null || value === undefined)
                        delete next[field.key]
                      else next[field.key] = value
                      return next
                    })
                  }
                />
              ))}
            </div>
          </>
        )}

        <h2 className={styles.sectionTitle}>Observações</h2>
        <Field label="Observações">
          <textarea
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            maxLength={5000}
          />
        </Field>
        <div className={styles.actions} style={{ marginTop: '1rem' }}>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar equipamento'}
          </button>
          <Link href={equipmentId ? `/inventory/equipment/${equipmentId}` : '/inventory/equipment'}>
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

interface RamSlot { qty: number; gb: number }

function parseRam(value: unknown): RamSlot[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (v): v is RamSlot =>
        typeof v === 'object' && v !== null && 'qty' in v && 'gb' in v,
    )
    .map((v) => ({ qty: Number(v.qty), gb: Number(v.gb) }))
    .filter((v) => v.qty > 0 && v.gb > 0)
}

function RamInput({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const [slots, setSlots] = useState<RamSlot[]>(() => {
    const parsed = parseRam(value)
    return parsed.length ? parsed : [{ qty: 1, gb: 8 }]
  })

  function update(next: RamSlot[]) {
    setSlots(next)
    const valid = next.filter((s) => s.qty > 0 && s.gb > 0)
    onChange(valid.length ? valid : null)
  }

  function setSlot(i: number, field: keyof RamSlot, val: number) {
    update(slots.map((s, idx) => (idx === i ? { ...s, [field]: val } : s)))
  }

  const total = slots.reduce((sum, s) => sum + s.qty * s.gb, 0)

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {slots.map((slot, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.35rem' }}>
          <input
            type="number"
            min="1"
            max="128"
            value={slot.qty}
            onChange={(e) => setSlot(i, 'qty', Number(e.target.value))}
            style={{ width: '4rem' }}
            aria-label="Quantidade"
          />
          <span>×</span>
          <input
            type="number"
            min="1"
            max="1024"
            value={slot.gb}
            onChange={(e) => setSlot(i, 'gb', Number(e.target.value))}
            style={{ width: '5rem' }}
            aria-label="GB"
          />
          <span>GB</span>
          {slots.length > 1 && (
            <button type="button" onClick={() => update(slots.filter((_, idx) => idx !== i))}>
              Remover
            </button>
          )}
        </div>
      ))}
      {total > 0 && (
        <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: '0.1rem 0 0.3rem' }}>
          Total: {total}GB
        </p>
      )}
      <button type="button" onClick={() => update([...slots, { qty: 1, gb: 8 }])} style={{ fontSize: '0.82rem' }}>
        + Pente
      </button>
    </div>
  )
}

function SpecField({
  field,
  value,
  onChange,
}: {
  field: InventoryFieldLookup
  value: unknown
  onChange: (value: unknown) => void
}) {
  if (field.type === 'RAM') {
    return <RamInput label={field.label} value={value} onChange={onChange} />
  }
  if (field.type === 'PASSWORD') {
    return (
      <div className={styles.field}>
        <span className={styles.fieldLabel}>{field.label}</span>
        <p className={styles.notice}>Credenciais não são armazenadas no inventário Bitrix.</p>
      </div>
    )
  }
  const textValue = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  if (field.type === 'BOOLEAN')
    return (
      <div className={styles.field}>
        <label>
          <input
            type="checkbox"
            checked={value === true || value === 'true' || value === '1'}
            onChange={(event) => onChange(event.target.checked)}
          />{' '}
          {field.label}
        </label>
      </div>
    )
  if (field.type === 'TEXTAREA')
    return (
      <Field label={field.label} required={field.required}>
        <textarea
          value={textValue}
          onChange={(event) => onChange(event.target.value)}
          required={field.required}
        />
      </Field>
    )
  if (field.type === 'SELECT')
    return (
      <Field label={field.label} required={field.required}>
        <select
          value={textValue}
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
  const type = field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'
  return (
    <Field label={field.label} required={field.required}>
      <input
        type={type}
        value={textValue}
        onChange={(event) =>
          onChange(
            field.type === 'NUMBER' && event.target.value !== ''
              ? Number(event.target.value)
              : event.target.value,
          )
        }
        required={field.required}
      />
    </Field>
  )
}

function normalizeSpecs(
  specs: Record<string, unknown>,
  fields: InventoryFieldLookup[],
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.type === 'PASSWORD') continue
    const value = specs[field.key]
    if (field.type === 'BOOLEAN' && (value === undefined || value === null || value === '')) {
      if (field.required) normalized[field.key] = false
      continue
    }
    if (value === undefined || value === null || value === '') continue
    if (field.type === 'NUMBER') {
      const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
      if (Number.isFinite(number)) normalized[field.key] = number
    } else if (field.type === 'BOOLEAN') {
      normalized[field.key] = value === true || value === 'true' || value === '1' || value === 'Sim'
    } else if (field.type === 'RAM') {
      const slots = parseRam(value)
      if (slots.length) normalized[field.key] = slots
    } else {
      normalized[field.key] = value
    }
  }
  return normalized
}

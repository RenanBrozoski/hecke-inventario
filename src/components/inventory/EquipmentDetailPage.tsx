'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { inventoryDateOnlyToday } from '@/src/modules/inventory/date'
import {
  EQUIPMENT_STATUS_LABELS,
  equipmentLabel,
  formatDate,
  formatDateTime,
  readApiError,
  statusTone,
} from './format'
import { InventoryAttachments } from './InventoryAttachments'
import { InventoryGate } from './InventoryGate'
import type { EquipmentDetail, InventoryContextResponse, InventoryLookupsResponse } from './types'
import styles from './inventory.module.css'

export function EquipmentDetailPage({ equipmentId }: { equipmentId: string }) {
  return (
    <InventoryGate>
      {(context) => <EquipmentDetailContent context={context} equipmentId={equipmentId} />}
    </InventoryGate>
  )
}

function EquipmentDetailContent({
  context,
  equipmentId,
}: {
  context: InventoryContextResponse
  equipmentId: string
}) {
  const router = useRouter()
  const { authorizedFetch } = useSession()
  const [equipment, setEquipment] = useState<EquipmentDetail | null>(null)
  const [lookups, setLookups] = useState<InventoryLookupsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [archiving, setArchiving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [equipmentResponse, lookupResponse] = await Promise.all([
        authorizedFetch(`/api/inventory/equipment/${equipmentId}`),
        authorizedFetch('/api/inventory/lookups'),
      ])
      if (!equipmentResponse.ok)
        throw new Error(await readApiError(equipmentResponse, 'Equipamento não encontrado.'))
      if (!lookupResponse.ok)
        throw new Error(
          await readApiError(lookupResponse, 'Não foi possível carregar os destinos.'),
        )
      setEquipment((await equipmentResponse.json()) as EquipmentDetail)
      setLookups((await lookupResponse.json()) as InventoryLookupsResponse)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o equipamento.')
    } finally {
      setLoading(false)
    }
  }, [authorizedFetch, equipmentId])

  useEffect(() => {
    void load()
  }, [load])

  const category = useMemo(
    () => lookups?.categories.find((item) => item.id === equipment?.categoryId) ?? null,
    [equipment?.categoryId, lookups],
  )

  if (loading) return <p className={styles.loading}>Carregando equipamento…</p>
  if (error) return <p className="alert alert-error">{error}</p>
  if (!equipment || !lookups) return null
  const equipmentToArchive = equipment
  const tone = statusTone(equipment.status)
  const legacyInvalidEntries = Object.entries(equipment.legacyInvalidSpecs ?? {})

  async function archive() {
    if (
      !window.confirm(
        `Arquivar ${equipmentLabel(equipmentToArchive)}? O histórico será preservado.`,
      )
    ) {
      return
    }
    setArchiving(true)
    setError(null)
    try {
      const response = await authorizedFetch(
        `/api/inventory/equipment/${equipmentToArchive.id}?revision=${equipmentToArchive.revision}`,
        { method: 'DELETE' },
      )
      if (!response.ok) {
        throw new Error(await readApiError(response, 'Não foi possível arquivar o equipamento.'))
      }
      router.push('/inventory/equipment')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao arquivar o equipamento.')
      setArchiving(false)
    }
  }

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <Link className="page-header__back" href="/inventory/equipment">
            ← Equipamentos
          </Link>
          <h1>{equipmentLabel(equipment)}</h1>
          <p className={styles.subtitle}>
            {equipment.category.name} ·{' '}
            <span className={`${styles.badge} ${tone === 'neutral' ? '' : styles[tone]}`}>
              {EQUIPMENT_STATUS_LABELS[equipment.status]}
            </span>
          </p>
        </div>
        {context.canEdit && (
          <div className={styles.actions}>
            <Link href={`/inventory/equipment/${equipment.id}/edit`}>
              <button type="button">Editar</button>
            </Link>
            <button type="button" disabled={archiving} onClick={() => void archive()}>
              {archiving ? 'Arquivando…' : 'Arquivar'}
            </button>
          </div>
        )}
      </header>

      <div className={styles.twoColumns}>
        <section className={styles.card}>
          <h2>Identificação e custódia</h2>
          <dl className={styles.definitionList}>
            <dt>Código / TAG</dt>
            <dd>{equipment.patrimony || '—'}</dd>
            <dt>Nº patrimônio</dt>
            <dd>{equipment.assetTag || '—'}</dd>
            <dt>Número de série</dt>
            <dd>{equipment.serialNumber || '—'}</dd>
            <dt>Responsável</dt>
            <dd>
              {equipment.currentHolder ? (
                <Link href={`/inventory/people/${equipment.currentHolder.id}`}>
                  {equipment.currentHolder.name}
                </Link>
              ) : (
                'Estoque / sem responsável'
              )}
            </dd>
            <dt>Setor</dt>
            <dd>{equipment.department?.name || '—'}</dd>
            <dt>Local / filial</dt>
            <dd>{equipment.location?.name || '—'}</dd>
            <dt>Detalhe do local</dt>
            <dd>{equipment.locationDetail || '—'}</dd>
            <dt>Nota fiscal</dt>
            <dd>{equipment.invoiceNumber || '—'}</dd>
          </dl>
        </section>
        <section className={styles.card}>
          <h2>Datas</h2>
          <dl className={styles.definitionList}>
            <dt>Aquisição</dt>
            <dd>{formatDate(equipment.acquiredAt)}</dd>
            <dt>Recebimento</dt>
            <dd>{formatDate(equipment.receivedAt)}</dd>
            <dt>Entrega</dt>
            <dd>{formatDate(equipment.deliveredAt)}</dd>
            <dt>Fim da garantia</dt>
            <dd>{formatDate(equipment.warrantyEndsAt)}</dd>
            <dt>Cadastrado em</dt>
            <dd>{formatDateTime(equipment.createdAt)}</dd>
            <dt>Atualizado em</dt>
            <dd>{formatDateTime(equipment.updatedAt)}</dd>
          </dl>
        </section>
      </div>

      {context.canEdit && (
        <TransferPanel equipment={equipment} lookups={lookups} onTransferred={load} />
      )}

      <div className={styles.twoColumns} style={{ marginTop: '1rem' }}>
        <section className={styles.card}>
          <h2>Especificações</h2>
          {category?.fields?.filter((field) => field.type !== 'PASSWORD').length ? (
            <dl className={styles.definitionList}>
              {category.fields
                .filter((field) => field.type !== 'PASSWORD')
                .map((field) => (
                  <div key={field.id} style={{ display: 'contents' }}>
                    <dt>{field.label}</dt>
                    <dd>{formatSpec(equipment.specs[field.key])}</dd>
                  </div>
                ))}
            </dl>
          ) : (
            <p className={styles.empty}>Nenhuma especificação configurada.</p>
          )}
          {category?.fields?.some((field) => field.type === 'PASSWORD') && (
            <p className={styles.notice}>
              Campos de senha foram excluídos da migração e não são exibidos.
            </p>
          )}
        </section>
        <section className={styles.card}>
          <h2>Observações</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{equipment.notes || 'Nenhuma observação.'}</p>
        </section>
      </div>

      {legacyInvalidEntries.length > 0 && (
        <section className={styles.card} style={{ marginTop: '1rem' }}>
          <h2>Valores legados para revisão</h2>
          <p className="alert alert-warning">
            Estes valores foram preservados fora das especificações porque não atendem ao formato
            atual de MAC/IP. Corrija-os na edição do equipamento ou deixe o campo vazio para
            descartá-los.
          </p>
          <dl className={styles.definitionList}>
            {legacyInvalidEntries.map(([key, value]) => (
              <div key={key} style={{ display: 'contents' }}>
                <dt>{category?.fields?.find((field) => field.key === key)?.label ?? key}</dt>
                <dd>{formatSpec(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className={styles.card} style={{ marginTop: '1rem' }}>
        <h2>Histórico de movimentações</h2>
        {!equipment.movements?.length ? (
          <p className={styles.empty}>Nenhuma movimentação registrada para este equipamento.</p>
        ) : (
          <ul className={styles.timeline}>
            {equipment.movements.map((movement) => (
              <li key={movement.id}>
                <div>
                  {movement.fromPersonName || 'Estoque / sem responsável'} →{' '}
                  {movement.toPersonName || 'Estoque / sem responsável'}
                </div>
                {(movement.fromDepartmentName || movement.toDepartmentName) && (
                  <div className={styles.timelineMeta}>
                    Setor: {movement.fromDepartmentName || '—'} → {movement.toDepartmentName || '—'}
                  </div>
                )}
                <div className={styles.timelineMeta}>
                  {formatDate(movement.movedAt)}
                  {movement.performedByName ? ` · ${movement.performedByName}` : ''}
                  {movement.reason ? ` · ${movement.reason}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <InventoryAttachments
        entityType="EQUIPMENT"
        entityId={equipment.id}
        canEdit={context.canEdit}
        className={styles.sectionTitle}
      />
    </div>
  )
}

function TransferPanel({
  equipment,
  lookups,
  onTransferred,
}: {
  equipment: EquipmentDetail
  lookups: InventoryLookupsResponse
  onTransferred: () => Promise<void>
}) {
  const { authorizedFetch } = useSession()
  const [open, setOpen] = useState(false)
  const [personId, setPersonId] = useState(equipment.currentHolder?.id ?? '')
  const [departmentId, setDepartmentId] = useState(equipment.department?.id ?? '')
  const [locationId, setLocationId] = useState(equipment.location?.id ?? '')
  const [status, setStatus] = useState(equipment.status)
  const [movedAt, setMovedAt] = useState(() => inventoryDateOnlyToday())
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    setPersonId(equipment.currentHolder?.id ?? '')
    setDepartmentId(equipment.department?.id ?? '')
    setLocationId(equipment.location?.id ?? '')
    setStatus(equipment.status)
    setMovedAt(inventoryDateOnlyToday())
    setReason('')
  }, [equipment])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const response = await authorizedFetch(`/api/inventory/equipment/${equipment.id}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: equipment.revision,
          toPersonId: personId || null,
          toDepartmentId: departmentId || null,
          locationId: locationId || null,
          status,
          movedAt,
          reason: reason.trim() || null,
        }),
      })
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível registrar a transferência.'))
      const body = (await response.json()) as { movement: unknown | null; changed: boolean }
      setMessage({
        type: 'success',
        text: body.movement
          ? 'Transferência registrada com sucesso.'
          : 'Localização/situação atualizada com sucesso.',
      })
      await onTransferred()
      setOpen(false)
    } catch (cause) {
      setMessage({
        type: 'error',
        text: cause instanceof Error ? cause.message : 'Falha ao registrar a transferência.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.pageHeader} style={{ marginBottom: open ? '1rem' : 0 }}>
        <div>
          <h2 style={{ marginBottom: 0 }}>Transferência e situação</h2>
          {!open && (
            <p className={styles.subtitle}>Altere responsável, setor, local ou situação.</p>
          )}
        </div>
        <button
          type="button"
          className={open ? '' : 'primary'}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Fechar' : 'Transferir / atualizar'}
        </button>
      </div>
      {message && (
        <p className={`alert ${message.type === 'error' ? 'alert-error' : 'alert-success'}`}>
          {message.text}
        </p>
      )}
      {open && (
        <form onSubmit={submit}>
          <div className={styles.formGrid}>
            <Field label="Novo responsável">
              <select value={personId} onChange={(event) => setPersonId(event.target.value)}>
                <option value="">Estoque / sem responsável</option>
                {lookups.people.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Novo setor">
              <select
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">Sem setor</option>
                {lookups.departments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <p className={`${styles.notice} ${styles.spanTwo}`}>
              Responsável e setor são independentes. Confirme ambos antes de registrar a
              movimentação.
            </p>
            <Field label="Local / filial">
              <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                <option value="">Sem local</option>
                {lookups.locations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Situação">
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as EquipmentDetail['status'])}
              >
                {Object.entries(EQUIPMENT_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Data da mudança">
              <input
                type="date"
                value={movedAt}
                onChange={(event) => setMovedAt(event.target.value)}
                required
              />
            </Field>
            <Field label="Motivo">
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
              />
            </Field>
          </div>
          <div className={styles.actions} style={{ marginTop: '1rem' }}>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Registrando…' : 'Confirmar alteração'}
            </button>
          </div>
        </form>
      )}
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

function formatSpec(value: unknown): string {
  if (value === true || value === 'true' || value === '1') return 'Sim'
  if (value === false || value === 'false' || value === '0') return 'Não'
  if (value === null || value === undefined || value === '') return '—'
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : JSON.stringify(value)
}

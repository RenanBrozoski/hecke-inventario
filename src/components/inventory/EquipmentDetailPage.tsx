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
  const [deleting, setDeleting] = useState(false)

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
  const isArchived = !!equipment.archivedAt

  async function archive() {
    if (
      !window.confirm(
        `Arquivar ${equipmentLabel(equipmentToArchive)}? O histórico será preservado.`,
      )
    )
      return
    setArchiving(true)
    setError(null)
    try {
      const response = await authorizedFetch(
        `/api/inventory/equipment/${equipmentToArchive.id}?revision=${equipmentToArchive.revision}`,
        { method: 'DELETE' },
      )
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível arquivar o equipamento.'))
      router.push('/inventory/equipment')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao arquivar o equipamento.')
      setArchiving(false)
    }
  }

  async function permanentlyDelete() {
    if (!window.confirm(`Excluir definitivamente ${equipmentLabel(equipmentToArchive)}? Esta ação não pode ser desfeita.`)) return
    setDeleting(true); setError(null)
    try {
      const response = await authorizedFetch(`/api/inventory/equipment/${equipmentToArchive.id}?revision=${equipmentToArchive.revision}&permanent=true`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiError(response, 'Não foi possível excluir o equipamento.'))
      router.push('/inventory/equipment'); router.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao excluir o equipamento.'); setDeleting(false) }
  }

  return (
    <div>
      {/* Cabeçalho */}
      <header className={styles.pageHeader}>
        <div>
          <Link className="page-header__back" href="/inventory/equipment">
            ← Equipamentos
          </Link>
          <h1>
            {equipmentLabel(equipment)}
            {isArchived && (
              <span className={`${styles.badge} ${styles.warning}`} style={{ marginLeft: '0.5rem', fontSize: '0.65rem', verticalAlign: 'middle' }}>
                Arquivado
              </span>
            )}
          </h1>
          <p className={styles.subtitle}>
            {equipment.category.name} ·{' '}
            <span className={`${styles.badge} ${tone === 'neutral' ? '' : styles[tone]}`}>
              {EQUIPMENT_STATUS_LABELS[equipment.status]}
            </span>
          </p>
        </div>
        {context.canEdit && !isArchived && (
          <div className={styles.actions}>
            <Link href={`/inventory/equipment/${equipment.id}/edit`}>
              <button type="button">Editar</button>
            </Link>
            <button type="button" disabled={archiving} onClick={() => void archive()}>
              {archiving ? 'Arquivando…' : 'Arquivar'}
            </button>
            {context.canAdmin && <button type="button" className="danger" disabled={deleting} onClick={() => void permanentlyDelete()}>{deleting ? 'Excluindo…' : 'Excluir'}</button>}
          </div>
        )}
      </header>

      {error && <p className="alert alert-error">{error}</p>}

      {/* Seção 1: Identificação */}
      <section className={styles.detailSection}>
        <h2 className={styles.detailSectionTitle}>Identificação</h2>
        <div className={styles.detailGrid}>
          <div className={styles.card}>
            <dl className={styles.definitionList}>
              <dt>Código interno (TI)</dt>
              <dd>{equipment.patrimony || '—'}</dd>
              <dt>TAG patrimonial</dt>
              <dd>{equipment.assetTag || '—'}</dd>
              <dt>Número de série</dt>
              <dd>{equipment.serialNumber || '—'}</dd>
              <dt>Nota fiscal</dt>
              <dd>{equipment.invoiceNumber || '—'}</dd>
              <dt>Categoria</dt>
              <dd>{equipment.category.name}</dd>
            </dl>
          </div>
          <div className={styles.card}>
            <h3 style={{ marginBottom: '0.75rem' }}>Datas</h3>
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
              <dt>Última alteração</dt>
              <dd>{formatDateTime(equipment.updatedAt)}</dd>
            </dl>
          </div>
        </div>
      </section>

      {/* Seção 2: Situação (custódia + localização) */}
      <section className={styles.detailSection}>
        <h2 className={styles.detailSectionTitle}>Situação</h2>
        <div className={styles.detailGrid}>
          <div className={styles.card}>
            <h3 style={{ marginBottom: '0.75rem' }}>Custódia</h3>
            <dl className={styles.definitionList}>
              <dt>Situação</dt>
              <dd>
                <span className={`${styles.badge} ${tone === 'neutral' ? '' : styles[tone]}`}>
                  {EQUIPMENT_STATUS_LABELS[equipment.status]}
                </span>
              </dd>
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
            </dl>
          </div>
          {context.canEdit && !isArchived && (
            <div>
              <TransferPanel equipment={equipment} lookups={lookups} onTransferred={load} />
            </div>
          )}
        </div>
      </section>

      {/* Seção 3: Informações adicionais */}
      <section className={styles.detailSection}>
        <h2 className={styles.detailSectionTitle}>Informações adicionais</h2>
        <div className={styles.detailGrid}>
          <div className={styles.card}>
            <h3 style={{ marginBottom: '0.75rem' }}>Especificações</h3>
            {category?.fields?.filter((f) => f.type !== 'PASSWORD').length ? (
              <dl className={styles.definitionList}>
                {category.fields
                  .filter((f) => f.type !== 'PASSWORD')
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
            {category?.fields?.some((f) => f.type === 'PASSWORD') && (
              <p className={styles.notice}>Campos de senha foram excluídos da migração.</p>
            )}
          </div>
          <div className={styles.card}>
            <h3 style={{ marginBottom: '0.75rem' }}>Observações</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{equipment.notes || 'Nenhuma observação.'}</p>

            {legacyInvalidEntries.length > 0 && (
              <>
                <h3 className={styles.sectionTitle} style={{ marginBottom: '0.75rem' }}>
                  Valores legados para revisão
                </h3>
                <p className="alert alert-info" style={{ fontSize: '0.8rem' }}>
                  Valores em formato inválido do legado. Corrija na edição ou deixe em branco para descartar.
                </p>
                <dl className={styles.definitionList}>
                  {legacyInvalidEntries.map(([key, value]) => (
                    <div key={key} style={{ display: 'contents' }}>
                      <dt>{category?.fields?.find((f) => f.key === key)?.label ?? key}</dt>
                      <dd>{formatSpec(value)}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Seção 4: Histórico */}
      <section className={styles.detailSection}>
        <h2 className={styles.detailSectionTitle}>Histórico</h2>
        <div className={styles.card}>
          {!equipment.movements?.length ? (
            <p className={styles.empty}>Nenhuma movimentação registrada para este equipamento.</p>
          ) : (
            <ul className={styles.timeline}>
              {equipment.movements.map((movement) => (
                <li key={movement.id}>
                  <div className={styles.timelineAction}>
                    <span className={`${styles.badge} ${styles.timelineTypeBadge}`}>
                      {movementOriginLabel(movement.origin)}
                    </span>
                    {movement.fromPersonName || movement.fromDepartmentName ? (
                      <>
                        {movement.fromPersonName || 'Sem responsável'} →{' '}
                        {movement.toPersonName || 'Sem responsável'}
                      </>
                    ) : (
                      <>Responsável: {movement.toPersonName || 'Sem responsável'}</>
                    )}
                  </div>
                  {(movement.fromDepartmentName || movement.toDepartmentName) && (
                    <div className={styles.timelineMeta}>
                      Setor: {movement.fromDepartmentName || '—'} →{' '}
                      {movement.toDepartmentName || '—'}
                    </div>
                  )}
                  {movement.reason && (
                    <div className={styles.timelineMeta}>Motivo: {movement.reason}</div>
                  )}
                  <div className={styles.timelineMeta}>
                    {formatDate(movement.movedAt)}
                    {movement.performedByName ? ` · ${movement.performedByName}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
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

function movementOriginLabel(origin: string): string {
  switch (origin) {
    case 'INITIAL_REGISTRATION':
      return 'Cadastro'
    case 'BULK_TRANSFER':
      return 'Transferência em lote'
    case 'IMPORT':
      return 'Importação'
    default:
      return 'Movimentação'
  }
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

  function selectPerson(nextPersonId: string) {
    const person = lookups.people.find((item) => item.id === nextPersonId)
    setPersonId(nextPersonId)
    if (person?.departmentId) setDepartmentId(person.departmentId)
  }

  return (
    <div className={styles.card}>
      <div className={styles.pageHeader} style={{ marginBottom: open ? '1rem' : 0 }}>
        <div>
          <h3 style={{ marginBottom: 0 }}>Transferência / situação</h3>
          {!open && (
            <p className={styles.subtitle} style={{ marginTop: '0.25rem' }}>
              Altere responsável, setor, local ou situação.
            </p>
          )}
        </div>
        <button
          type="button"
          className={open ? '' : 'primary'}
          onClick={() => setOpen((v) => !v)}
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
            <Field label="Responsável">
              <select value={personId} onChange={(e) => selectPerson(e.target.value)}>
                <option value="">Estoque / sem responsável</option>
                {lookups.people.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Setor">
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">Sem setor</option>
                {lookups.departments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <p className={`${styles.notice} ${styles.spanTwo}`}>
              O setor é preenchido automaticamente conforme o responsável quando disponível; você pode ajustá-lo antes de registrar.
            </p>
            <Field label="Local / filial">
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
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
                onChange={(e) => setStatus(e.target.value as EquipmentDetail['status'])}
              >
                {Object.entries(EQUIPMENT_STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Data da mudança">
              <input
                type="date"
                value={movedAt}
                onChange={(e) => setMovedAt(e.target.value)}
                required
              />
            </Field>
            <Field label="Motivo">
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </Field>
          </div>
          <div className={styles.actions} style={{ marginTop: '1rem' }}>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Registrando…' : 'Confirmar alteração'}
            </button>
          </div>
        </form>
      )}
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

function formatSpec(value: unknown): string {
  if (value === true || value === 'true' || value === '1') return 'Sim'
  if (value === false || value === 'false' || value === '0') return 'Não'
  if (value === null || value === undefined || value === '') return '—'
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : JSON.stringify(value)
}

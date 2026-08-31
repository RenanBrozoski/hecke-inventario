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
import { InventoryGate, useInventoryContext } from './InventoryGate'
import type { EquipmentAuditEvent, EquipmentDetail, InventoryLookupsResponse, InventoryMovement } from './types'
import styles from './inventory.module.css'

export function EquipmentDetailPage({ equipmentId }: { equipmentId: string }) {
  return <InventoryGate><EquipmentDetailContent equipmentId={equipmentId} /></InventoryGate>
}

function EquipmentDetailContent({ equipmentId }: { equipmentId: string }) {
  const context = useInventoryContext()
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
              <dd>
                {formatDateTime(equipment.updatedAt)}
                {(() => {
                  const d = daysSince(equipment.updatedAt)
                  if (d === null) return null
                  return (
                    <span
                      className={styles.badge}
                      style={{ marginLeft: '0.4rem', fontSize: '0.65rem', verticalAlign: 'middle' }}
                    >
                      {daysAgoLabel(d)}
                    </span>
                  )
                })()}
              </dd>
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
            <AgentSyncBadge specs={equipment.specs} />
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

      {/* Seção 4: Ações remotas (só aparece se o agente estiver instalado) */}
      {context.canEdit && (() => {
        const collector = (equipment.specs as Record<string, unknown>).collector as Record<string, unknown> | undefined
        if (!collector?.syncedAt) return null
        return (
          <section className={styles.detailSection}>
            <h2 className={styles.detailSectionTitle}>Ações remotas</h2>
            <RemoteActionsPanel equipmentId={equipment.id} authorizedFetch={authorizedFetch} />
          </section>
        )
      })()}

      {/* Seção 5: Histórico unificado */}
      <section className={styles.detailSection}>
        <h2 className={styles.detailSectionTitle}>Histórico</h2>
        <div className={styles.card}>
          <UnifiedTimeline movements={equipment.movements} auditEvents={equipment.auditEvents} />
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

type TimelineEntry =
  | { kind: 'movement'; data: InventoryMovement; ts: number }
  | { kind: 'audit'; data: EquipmentAuditEvent; ts: number }

function UnifiedTimeline({
  movements,
  auditEvents,
}: {
  movements?: InventoryMovement[]
  auditEvents?: EquipmentAuditEvent[]
}) {
  const entries: TimelineEntry[] = [
    ...(movements ?? []).map((m) => ({
      kind: 'movement' as const,
      data: m,
      ts: new Date(m.movedAt ?? m.createdAt).getTime(),
    })),
    ...(auditEvents ?? []).map((a) => ({
      kind: 'audit' as const,
      data: a,
      ts: new Date(a.createdAt).getTime(),
    })),
  ].sort((a, b) => b.ts - a.ts)

  if (!entries.length) {
    return <p className={styles.empty}>Nenhum histórico registrado para este equipamento.</p>
  }

  return (
    <ul className={styles.timeline}>
      {entries.map((entry) =>
        entry.kind === 'movement' ? (
          <MovementEntry key={`m-${entry.data.id}`} movement={entry.data} />
        ) : (
          <AuditEntry key={`a-${entry.data.id}`} event={entry.data} />
        ),
      )}
    </ul>
  )
}

function MovementEntry({ movement }: { movement: InventoryMovement }) {
  return (
    <li>
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
          Setor: {movement.fromDepartmentName || '—'} → {movement.toDepartmentName || '—'}
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
  )
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  inventory_equipment_created: 'Cadastrado',
  inventory_equipment_updated: 'Editado',
  inventory_equipment_archived: 'Arquivado',
  inventory_equipment_restored: 'Restaurado',
  inventory_equipment_deleted: 'Excluído',
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  patrimony: 'Código interno',
  assetTag: 'TAG patrimonial',
  name: 'Nome',
  categoryId: 'Categoria',
  status: 'Situação',
  currentHolderId: 'Responsável',
  departmentId: 'Setor',
  locationId: 'Local',
  locationDetail: 'Detalhe do local',
  serialNumber: 'Número de série',
  invoiceNumber: 'Nota fiscal',
  acquiredAt: 'Data de aquisição',
  receivedAt: 'Data de recebimento',
  deliveredAt: 'Data de entrega',
  warrantyEndsAt: 'Fim da garantia',
  notes: 'Observações',
}

function AuditEntry({ event }: { event: EquipmentAuditEvent }) {
  const label = AUDIT_ACTION_LABELS[event.action] ?? event.action.replace(/^inventory_/, '').replace(/_/g, ' ')
  const meta = event.metadata
  const changedFields = (meta?.changedFields as string[] | undefined) ?? []
  const before = (meta?.before as Record<string, unknown> | undefined) ?? {}
  const after = (meta?.after as Record<string, unknown> | undefined) ?? {}

  return (
    <li>
      <div className={styles.timelineAction}>
        <span className={`${styles.badge} ${styles.timelineTypeBadge}`} style={{ background: 'var(--color-bg)', color: 'var(--color-primary)', border: '1px solid var(--color-primary)' }}>
          {label}
        </span>
      </div>
      {changedFields.length > 0 && (
        <div className={styles.timelineMeta} style={{ marginTop: '0.25rem' }}>
          {changedFields.map((field) => {
            const fieldLabel = AUDIT_FIELD_LABELS[field] ?? field
            const bVal = field in before ? formatAuditValue(before[field]) : null
            const aVal = field in after ? formatAuditValue(after[field]) : null
            if (bVal === null && aVal === null) return null
            return (
              <span key={field} style={{ display: 'block' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>{fieldLabel}:</span>{' '}
                {bVal !== null && <span style={{ color: 'var(--color-danger)', textDecoration: 'line-through', marginRight: '0.25rem' }}>{bVal}</span>}
                {aVal !== null && <span style={{ color: 'var(--color-success)' }}>{aVal}</span>}
              </span>
            )
          })}
        </div>
      )}
      <div className={styles.timelineMeta}>
        {formatDateTime(event.createdAt)}
        {event.userName ? ` · ${event.userName}` : event.bitrixUserId ? ` · #${event.bitrixUserId}` : ''}
      </div>
    </li>
  )
}

function formatAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) return '(vazio)'
  if (typeof value === 'string') return value || '(vazio)'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
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

const COMMAND_LABELS: Record<string, string> = {
  SET_WALLPAPER: 'Wallpaper',
  SHOW_MESSAGE: 'Mensagem',
  MAP_DRIVE: 'Mapear drive',
}

const COMMAND_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Aguardando',
  SENT: 'Enviado',
  DONE: 'Concluído',
  FAILED: 'Falhou',
}

const COMMAND_STATUS_TONE: Record<string, string> = {
  PENDING: '',
  SENT: 'warning',
  DONE: 'success',
  FAILED: 'danger',
}

type RemoteCommand = {
  id: string
  command: string
  params: Record<string, unknown>
  status: string
  result: string | null
  createdAt: string
  sentAt: string | null
  doneAt: string | null
}

function RemoteActionsPanel({
  equipmentId,
  authorizedFetch,
}: {
  equipmentId: string
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>
}) {
  const [commands, setCommands] = useState<RemoteCommand[]>([])
  const [sending, setSending] = useState(false)
  const [cmdType, setCmdType] = useState<string>('SET_WALLPAPER')
  const [params, setParams] = useState<Record<string, string>>({})
  const [sendError, setSendError] = useState<string | null>(null)

  const loadCommands = useCallback(async () => {
    const res = await authorizedFetch(`/api/inventory/equipment/${equipmentId}/commands`)
    if (res.ok) setCommands((await res.json()) as RemoteCommand[])
  }, [authorizedFetch, equipmentId])

  useEffect(() => { void loadCommands() }, [loadCommands])

  const setParam = (key: string, value: string) =>
    setParams((prev) => ({ ...prev, [key]: value }))

  const send = async () => {
    setSendError(null)
    setSending(true)
    try {
      const res = await authorizedFetch(`/api/inventory/equipment/${equipmentId}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipmentId, command: cmdType, params }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Erro ao enviar comando.')
      }
      setParams({})
      await loadCommands()
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Erro desconhecido.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={styles.remoteActionsPanel}>
      {/* Formulário de novo comando */}
      <div className={styles.card}>
        <h3 style={{ marginBottom: '0.75rem' }}>Novo comando</h3>
        <div className={styles.remoteActionsForm}>
          <label>
            Tipo
            <select value={cmdType} onChange={(e) => { setCmdType(e.target.value); setParams({}) }}>
              {Object.entries(COMMAND_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>

          {cmdType === 'SET_WALLPAPER' && (
            <>
              <label>
                URL da imagem
                <input
                  type="url"
                  placeholder="https://..."
                  value={params.url ?? ''}
                  onChange={(e) => setParam('url', e.target.value)}
                />
              </label>
              <label>
                Estilo
                <select value={params.style ?? 'FILL'} onChange={(e) => setParam('style', e.target.value)}>
                  <option value="FILL">Preencher</option>
                  <option value="FIT">Ajustar</option>
                  <option value="STRETCH">Esticar</option>
                  <option value="TILE">Lado a lado</option>
                  <option value="CENTER">Centralizar</option>
                </select>
              </label>
            </>
          )}

          {cmdType === 'SHOW_MESSAGE' && (
            <>
              <label>
                Título
                <input
                  type="text"
                  placeholder="Aviso de TI"
                  value={params.title ?? ''}
                  onChange={(e) => setParam('title', e.target.value)}
                />
              </label>
              <label>
                Mensagem
                <textarea
                  rows={3}
                  placeholder="Texto da mensagem..."
                  value={params.body ?? ''}
                  onChange={(e) => setParam('body', e.target.value)}
                />
              </label>
            </>
          )}

          {cmdType === 'MAP_DRIVE' && (
            <>
              <label>
                Letra do drive
                <input
                  type="text"
                  maxLength={1}
                  placeholder="Z"
                  value={params.letter ?? ''}
                  onChange={(e) => setParam('letter', e.target.value.toUpperCase())}
                  style={{ width: '4rem' }}
                />
              </label>
              <label>
                Caminho de rede
                <input
                  type="text"
                  placeholder="\\servidor\pasta"
                  value={params.path ?? ''}
                  onChange={(e) => setParam('path', e.target.value)}
                />
              </label>
            </>
          )}

          {sendError && <p className="alert alert-error" style={{ margin: 0 }}>{sendError}</p>}

          <button type="button" disabled={sending} onClick={() => void send()}>
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
          O comando será executado na próxima vez que o agente acordar (até 6 h).
        </p>
      </div>

      {/* Histórico de comandos */}
      {commands.length > 0 && (
        <div className={styles.card}>
          <h3 style={{ marginBottom: '0.75rem' }}>Histórico de comandos</h3>
          <table className={styles.compactTable}>
            <thead>
              <tr>
                <th>Comando</th>
                <th>Status</th>
                <th>Enviado</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {commands.map((c) => (
                <tr key={c.id}>
                  <td>{COMMAND_LABELS[c.command] ?? c.command}</td>
                  <td>
                    <span className={`${styles.badge} ${COMMAND_STATUS_TONE[c.status] ? styles[COMMAND_STATUS_TONE[c.status] as keyof typeof styles] : ''}`}>
                      {COMMAND_STATUS_LABELS[c.status] ?? c.status}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.8rem' }}>{formatDateTime(c.createdAt)}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    {c.result ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AgentSyncBadge({ specs }: { specs: Record<string, unknown> }) {
  const collector = specs.collector as Record<string, string> | undefined
  const syncedAt = collector?.syncedAt
  if (!syncedAt) return null
  const days = daysSince(syncedAt)
  if (days === null) return null
  const stale = days > 7
  return (
    <div className={styles.agentSyncInfo}>
      <span className={styles.agentSyncLabel}>
        Última leitura do agente:{' '}
        <strong>{daysAgoLabel(days)}</strong>
      </span>
      {stale && (
        <span className={`${styles.badge} ${styles.warning}`} style={{ fontSize: '0.65rem' }}>
          Agente desatualizado
        </span>
      )}
      <span className={styles.agentSyncDate}>{formatDateTime(syncedAt)}</span>
    </div>
  )
}

function daysSince(isoString: string | null | undefined): number | null {
  if (!isoString) return null
  const ms = Date.now() - new Date(isoString).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

function daysAgoLabel(days: number): string {
  if (days === 0) return 'hoje'
  if (days === 1) return 'ontem'
  return `${days} dias atrás`
}

function formatRamSlots(value: unknown): string | null {
  if (!Array.isArray(value) || !value.length) return null
  const slots = value
    .filter(
      (v): v is { qty: number; gb: number } =>
        typeof v === 'object' && v !== null && 'qty' in v && 'gb' in v,
    )
    .map((v) => ({ qty: Number(v.qty), gb: Number(v.gb) }))
    .filter((v) => v.qty > 0 && v.gb > 0)
  if (!slots.length) return null
  const parts = slots.map((s) => `${s.qty}× ${s.gb}GB`)
  const total = slots.reduce((sum, s) => sum + s.qty * s.gb, 0)
  return parts.join(' + ') + ` = ${total}GB`
}

function formatSpec(value: unknown): string {
  if (value === true || value === 'true' || value === '1') return 'Sim'
  if (value === false || value === 'false' || value === '0') return 'Não'
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return formatRamSlots(value) ?? '—'
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : JSON.stringify(value)
}

'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { inventoryDateOnlyToday } from '@/src/modules/inventory/date'
import { equipmentLabel, readApiError } from './format'
import type { InventoryLookupsResponse, PersonDetail } from './types'
import styles from './inventory.module.css'

interface BulkTransferPanelProps {
  person: Pick<PersonDetail, 'id' | 'name' | 'equipment'>
  onTransferred?: () => Promise<void> | void
}

interface BulkTransferResponse {
  transferredCount: number
  term: { id: string } | null
}

/**
 * Painel isolado para ser montado pela ficha da pessoa somente quando o
 * contexto permitir edição. Ele captura as revisions que vieram junto dos
 * equipamentos e envia o lote fechado para o CAS do servidor.
 */
export function BulkTransferPanel({ person, onTransferred }: BulkTransferPanelProps) {
  const { authorizedFetch } = useSession()
  const equipment = useMemo(() => person.equipment ?? [], [person.equipment])
  const [people, setPeople] = useState<InventoryLookupsResponse['people']>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [destinationPersonId, setDestinationPersonId] = useState('')
  const [movedAt, setMovedAt] = useState(() => inventoryDateOnlyToday())
  const [reason, setReason] = useState('')
  const [createTerm, setCreateTerm] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BulkTransferResponse | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const response = await authorizedFetch('/api/inventory/lookups')
        if (!response.ok) {
          throw new Error(await readApiError(response, 'Não foi possível carregar os destinos.'))
        }
        const body = (await response.json()) as InventoryLookupsResponse
        if (active) setPeople(body.people.filter((candidate) => candidate.id !== person.id))
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Falha ao carregar os destinos.')
        }
      }
    })()
    return () => {
      active = false
    }
  }, [authorizedFetch, person.id])

  useEffect(() => {
    const available = new Set(equipment.map((item) => item.id))
    setSelectedIds((current) => current.filter((id) => available.has(id)))
  }, [equipment])

  function toggle(equipmentId: string) {
    setSelectedIds((current) =>
      current.includes(equipmentId)
        ? current.filter((id) => id !== equipmentId)
        : [...current, equipmentId],
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (selectedIds.length === 0) {
      setError('Selecione ao menos um equipamento.')
      return
    }

    const selected = equipment.filter((item) => selectedIds.includes(item.id))
    setSaving(true)
    setError(null)
    setResult(null)
    try {
      const response = await authorizedFetch(`/api/inventory/people/${person.id}/bulk-transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentIds: selected.map((item) => item.id),
          expectedRevisions: Object.fromEntries(selected.map((item) => [item.id, item.revision])),
          destinationPersonId: destinationPersonId || null,
          movedAt,
          reason: reason.trim() || null,
          createTerm,
        }),
      })
      if (!response.ok) {
        throw new Error(
          await readApiError(response, 'Não foi possível concluir a transferência em lote.'),
        )
      }
      const body = (await response.json()) as BulkTransferResponse
      setResult(body)
      setSelectedIds([])
      setReason('')
      await onTransferred?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao transferir os equipamentos.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={styles.card} style={{ marginTop: '1rem' }}>
      <h2>Transferência em lote</h2>
      <p className={styles.notice}>
        Selecione equipamentos atualmente sob responsabilidade de {person.name}. Ao enviar para
        estoque, o setor atual de cada item será preservado.
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      {result && (
        <p className="alert alert-success">
          {result.transferredCount} equipamento(s) transferido(s).
          {result.term ? (
            <>
              {' '}
              <Link href={`/inventory/terms/${result.term.id}`}>Abrir termo</Link>
            </>
          ) : null}
        </p>
      )}
      {equipment.length === 0 ? (
        <p className={styles.empty}>Esta pessoa não possui equipamentos para transferir.</p>
      ) : (
        <form onSubmit={submit}>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os equipamentos"
                      checked={selectedIds.length === equipment.length}
                      onChange={(event) =>
                        setSelectedIds(event.target.checked ? equipment.map((item) => item.id) : [])
                      }
                    />
                  </th>
                  <th>Equipamento</th>
                  <th>Categoria</th>
                  <th>Setor atual</th>
                </tr>
              </thead>
              <tbody>
                {equipment.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${equipmentLabel(item)}`}
                        checked={selectedIds.includes(item.id)}
                        onChange={() => toggle(item.id)}
                      />
                    </td>
                    <td>
                      <Link href={`/inventory/equipment/${item.id}`}>{equipmentLabel(item)}</Link>
                    </td>
                    <td>{item.category.name}</td>
                    <td>{item.department?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`${styles.formGrid} ${styles.sectionTitle}`}>
            <div className={styles.field}>
              <label htmlFor="bulk-transfer-destination">Destino</label>
              <select
                id="bulk-transfer-destination"
                value={destinationPersonId}
                onChange={(event) => setDestinationPersonId(event.target.value)}
              >
                <option value="">Estoque / sem responsável</option>
                {people.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="bulk-transfer-date">Data</label>
              <input
                id="bulk-transfer-date"
                type="date"
                value={movedAt}
                onChange={(event) => setMovedAt(event.target.value)}
                required
              />
            </div>
            <div className={`${styles.field} ${styles.spanTwo}`}>
              <label htmlFor="bulk-transfer-reason">Motivo</label>
              <input
                id="bulk-transfer-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
              />
            </div>
          </div>
          <label>
            <input
              type="checkbox"
              checked={createTerm}
              onChange={(event) => setCreateTerm(event.target.checked)}
            />{' '}
            Gerar termo de transferência
          </label>
          <div className={styles.actions} style={{ marginTop: '1rem' }}>
            <button className="primary" type="submit" disabled={saving || selectedIds.length === 0}>
              {saving ? 'Transferindo…' : `Transferir ${selectedIds.length || ''}`.trim()}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

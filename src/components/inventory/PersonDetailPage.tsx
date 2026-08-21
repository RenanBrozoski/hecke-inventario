'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import {
  EMPLOYMENT_TYPE_LABELS,
  EQUIPMENT_STATUS_LABELS,
  PERSON_STATUS_LABELS,
  equipmentLabel,
  formatDateTime,
  readApiError,
  statusTone,
} from './format'
import { BulkTransferPanel } from './BulkTransferPanel'
import { InventoryAttachments } from './InventoryAttachments'
import { InventoryGate } from './InventoryGate'
import type { InventoryContextResponse, PersonDetail } from './types'
import styles from './inventory.module.css'

const TERM_LABELS: Record<string, string> = {
  DELIVERY: 'Entrega',
  RESPONSIBILITY: 'Responsabilidade',
  RETURN: 'Devolução',
  TRANSFER: 'Transferência',
}

export function PersonDetailPage({ personId }: { personId: string }) {
  return (
    <InventoryGate>
      {(context) => <PersonDetailContent context={context} personId={personId} />}
    </InventoryGate>
  )
}

function PersonDetailContent({
  context,
  personId,
}: {
  context: InventoryContextResponse
  personId: string
}) {
  const router = useRouter()
  const { authorizedFetch } = useSession()
  const [person, setPerson] = useState<PersonDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await authorizedFetch(`/api/inventory/people/${personId}`)
      if (!response.ok) throw new Error(await readApiError(response, 'Colaborador não encontrado.'))
      setPerson((await response.json()) as PersonDetail)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o colaborador.')
    } finally {
      setLoading(false)
    }
  }, [authorizedFetch, personId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <p className={styles.loading}>Carregando colaborador…</p>
  if (error) return <p className="alert alert-error">{error}</p>
  if (!person) return null
  const personToArchive = person
  const tone = statusTone(person.status)

  async function archive() {
    if (!window.confirm(`Arquivar o cadastro de ${personToArchive.name}?`)) return
    setArchiving(true)
    setError(null)
    try {
      const response = await authorizedFetch(
        `/api/inventory/people/${personToArchive.id}?revision=${personToArchive.revision}`,
        { method: 'DELETE' },
      )
      if (!response.ok) {
        throw new Error(await readApiError(response, 'Não foi possível arquivar o colaborador.'))
      }
      router.push('/inventory/people')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao arquivar o colaborador.')
      setArchiving(false)
    }
  }

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <Link className="page-header__back" href="/inventory/people">
            ← Colaboradores
          </Link>
          <h1>{person.name}</h1>
          <p className={styles.subtitle}>
            {person.department?.name ?? 'Sem setor'} ·{' '}
            <span className={`${styles.badge} ${tone === 'neutral' ? '' : styles[tone]}`}>
              {PERSON_STATUS_LABELS[person.status]}
            </span>
          </p>
        </div>
        {context.canEdit && (
          <div className={styles.actions}>
            <Link href={`/inventory/people/${person.id}/edit`}>
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
          <h2>Cadastro</h2>
          <dl className={styles.definitionList}>
            <dt>Cargo</dt>
            <dd>{person.title || '—'}</dd>
            <dt>E-mail</dt>
            <dd>{person.email || '—'}</dd>
            <dt>Matrícula</dt>
            <dd>{person.employeeNumber || '—'}</dd>
            <dt>Vínculo</dt>
            <dd>{person.employmentType ? EMPLOYMENT_TYPE_LABELS[person.employmentType] : '—'}</dd>
            <dt>Usuário Bitrix</dt>
            <dd>{person.bitrixUserId ? `#${person.bitrixUserId}` : 'Não vinculado'}</dd>
            <dt>Cadastrado em</dt>
            <dd>{formatDateTime(person.createdAt)}</dd>
          </dl>
        </section>
        <section className={styles.card}>
          <h2>Observações</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{person.notes || 'Nenhuma observação.'}</p>
        </section>
      </div>
      <section className={styles.card} style={{ marginBottom: '1rem' }}>
        <div className={styles.pageHeader} style={{ marginBottom: '0.75rem' }}>
          <h2>Equipamentos atuais</h2>
          <span className={styles.badge}>{person.equipment?.length ?? 0}</span>
        </div>
        {!person.equipment?.length ? (
          <p className={styles.empty}>Nenhum equipamento sob responsabilidade desta pessoa.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Identificação</th>
                  <th>Categoria</th>
                  <th>Situação</th>
                  <th>Setor</th>
                  <th>Local</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {person.equipment.map((item) => {
                  const equipmentTone = statusTone(item.status)
                  return (
                    <tr key={item.id}>
                      <td>
                        <Link href={`/inventory/equipment/${item.id}`}>{equipmentLabel(item)}</Link>
                      </td>
                      <td>{item.category.name}</td>
                      <td>
                        <span
                          className={`${styles.badge} ${equipmentTone === 'neutral' ? '' : styles[equipmentTone]}`}
                        >
                          {EQUIPMENT_STATUS_LABELS[item.status]}
                        </span>
                      </td>
                      <td>{item.department?.name ?? '—'}</td>
                      <td>{item.location?.name ?? '—'}</td>
                      <td>
                        <Link href={`/inventory/equipment/${item.id}`}>Abrir</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {context.canEdit && <BulkTransferPanel person={person} onTransferred={load} />}
      <section className={styles.card}>
        <h2>Termos</h2>
        {!person.termsAsOrigin?.length ? (
          <p className={styles.empty}>Nenhum termo gerado.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Criado em</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {person.termsAsOrigin.map((term) => (
                  <tr key={term.id}>
                    <td>{TERM_LABELS[term.type] ?? term.type}</td>
                    <td>{formatDateTime(term.createdAt)}</td>
                    <td>
                      <Link href={`/inventory/terms/${term.id}`}>Abrir</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <InventoryAttachments
        entityType="PERSON"
        entityId={person.id}
        canEdit={context.canEdit}
        className={styles.sectionTitle}
      />
    </div>
  )
}

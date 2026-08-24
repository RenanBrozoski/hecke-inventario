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
      <div className={styles.twoColumns}>
        <section className={styles.card}>
          <div className={styles.pageHeader} style={{ marginBottom: '0.75rem' }}>
            <h2>Linhas corporativas</h2>
            <Link href="/inventory/corporate-lines">Gerenciar linhas</Link>
          </div>
          {!person.corporateLines?.length ? (
            <p className={styles.empty}>Nenhuma linha corporativa vinculada.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Número</th><th>Plano</th><th>Smartphone / SIM</th></tr></thead>
                <tbody>
                  {person.corporateLines.map((line) => (
                    <tr key={line.id}>
                      <td><Link href={`/inventory/corporate-lines/${line.id}`}>{line.number}</Link></td>
                      <td>{[line.carrier, line.plan, line.dataAllowance].filter(Boolean).join(' · ') || '—'}</td>
                      <td>{line.equipment ? <Link href={`/inventory/equipment/${line.equipment.id}`}>{equipmentLabel(line.equipment)}</Link> : 'Sem smartphone'}{line.simSlot ? ` · ${line.simSlot}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className={styles.card}>
          <h2>Ramais</h2>
          {!person.extensions?.length ? <p className={styles.empty}>Nenhum ramal encontrado.</p> : (
            <ul className={styles.timeline}>
              {person.extensions.map((extension) => (
                <li key={extension.id}><strong>{extension.number || 'Sem número'}</strong><div className={styles.timelineMeta}>{extension.type || 'Ramal'}{extension.notes ? ` · ${extension.notes}` : ''}</div></li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className={styles.card} style={{ marginBottom: '1rem' }}>
        <h2>Histórico de equipamentos e movimentações</h2>
        {!person.movementHistory?.length ? <p className={styles.empty}>Nenhuma movimentação registrada.</p> : (
          <ul className={styles.timeline}>
            {person.movementHistory.map((movement) => (
              <li key={movement.id}>
                <strong>{movement.equipment ? <Link href={`/inventory/equipment/${movement.equipment.id}`}>{equipmentLabel(movement.equipment)}</Link> : 'Equipamento'}</strong>
                <div>{movement.fromPersonName || 'Estoque'} → {movement.toPersonName || 'Estoque'}</div>
                <div className={styles.timelineMeta}>{formatDateTime(movement.createdAt)}{movement.reason ? ` · ${movement.reason}` : ''}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.card} style={{ marginBottom: '1rem' }}>
        <h2>Alterações relevantes</h2>
        {!person.audit?.length ? <p className={styles.empty}>Nenhuma alteração registrada.</p> : (
          <ul className={styles.timeline}>
            {person.audit.map((event) => <li key={event.id}><strong>{event.action.replace(/^inventory_/, '').replaceAll('_', ' ')}</strong><div className={styles.timelineMeta}>{formatDateTime(event.createdAt)} · usuário Bitrix #{event.bitrixUserId}</div></li>)}
          </ul>
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

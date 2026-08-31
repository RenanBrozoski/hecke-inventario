'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import {
  EQUIPMENT_STATUS_LABELS,
  equipmentLabel,
  formatDate,
  readApiError,
  statusTone,
} from './format'
import { InventoryGate, useInventoryContext } from './InventoryGate'
import type { DashboardResponse, EquipmentStatus } from './types'
import styles from './inventory.module.css'

export function InventoryDashboardPage() {
  return <InventoryGate><DashboardContent /></InventoryGate>
}

function DashboardContent() {
  const context = useInventoryContext()
  const { authorizedFetch } = useSession()
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await authorizedFetch('/api/inventory/dashboard')
      if (!response.ok)
        throw new Error(await readApiError(response, 'Não foi possível carregar o painel.'))
      setDashboard((await response.json()) as DashboardResponse)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o painel.')
    }
  }, [authorizedFetch])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <h1>Inventário de TI</h1>
          <p className={styles.subtitle}>Ativos, responsáveis e movimentações em um só lugar.</p>
        </div>
        {context.canEdit && (
          <div className={styles.actions}>
            <Link href="/inventory/equipment/new">
              <button type="button" className="primary">
                + Equipamento
              </button>
            </Link>
            <Link href="/inventory/people/new">
              <button type="button">+ Colaborador</button>
            </Link>
          </div>
        )}
      </header>

      {error && (
        <div>
          <p className="alert alert-error">{error}</p>
          <button type="button" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      )}
      {!dashboard && !error && <p className={styles.loading}>Carregando indicadores…</p>}

      {dashboard && (
        <>
          <section className={styles.grid} aria-label="Indicadores do inventário">
            <Metric label="Equipamentos" value={dashboard.counts.equipment} />
            <Metric
              label="Colaboradores"
              value={dashboard.counts.activePeople ?? dashboard.counts.people}
            />
            <Metric label="Setores" value={dashboard.counts.departments} />
            <Metric label="Recebimentos" value={dashboard.counts.receivings ?? 0} />
            <Metric label="Sem responsável" value={dashboard.counts.withoutHolder ?? 0} tone={(dashboard.counts.withoutHolder ?? 0) > 0 ? 'warning' : 'default'} />
            <Metric label="Vencidos" value={dashboard.counts.expired ?? 0} tone={(dashboard.counts.expired ?? 0) > 0 ? 'warning' : 'default'} />
            <Metric label="Vencem em 30 dias" value={dashboard.counts.expiringSoon ?? 0} tone={(dashboard.counts.expiringSoon ?? 0) > 0 ? 'warning' : 'default'} />
            <Metric label="Categorias" value={dashboard.counts.categories ?? 0} />
          </section>

          <div className={styles.twoColumns}>
            <section className={styles.card}>
              <h2>Situação dos equipamentos</h2>
              {Object.keys(dashboard.equipmentByStatus).length === 0 ? (
                <p className={styles.empty}>Nenhum equipamento cadastrado.</p>
              ) : (
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Situação</th>
                        <th>Quantidade</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        Object.entries(dashboard.equipmentByStatus) as Array<
                          [EquipmentStatus, number]
                        >
                      ).map(([status, count]) => (
                        <tr key={status}>
                          <td>
                            <StatusBadge status={status} />
                          </td>
                          <td>{count}</td>
                          <td>
                            <Link href={`/inventory/equipment?status=${status}`}>
                              Ver equipamentos
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={styles.card}>
              <h2>Cadastros auxiliares</h2>
              <dl className={styles.definitionList}>
                <dt>Locais cadastrados</dt>
                <dd>{dashboard.counts.locations ?? 0}</dd>
                <dt>Ramais ativos</dt>
                <dd>{dashboard.counts.extensions ?? 0}</dd>
                <dt>Colaboradores no cadastro</dt>
                <dd>{dashboard.counts.people}</dd>
              </dl>
            </section>
          </div>

          {(dashboard.counts.withoutHolder ?? 0) + (dashboard.counts.linesWithoutEquipment ?? 0) + (dashboard.counts.peopleWithoutEquipment ?? 0) + (dashboard.counts.expiringSoon ?? 0) > 0 && (
            <section className={`${styles.card} ${styles.alertsCard}`}>
              <h2>Alertas operacionais</h2>
              <div className={styles.alertRows}>
                {(dashboard.counts.withoutHolder ?? 0) > 0 && (
                  <div className={styles.alertRow}>
                    <span><strong>{dashboard.counts.withoutHolder}</strong> equipamento(s) sem responsável</span>
                    <Link href="/inventory/equipment">Ver equipamentos</Link>
                  </div>
                )}
                {(dashboard.counts.linesWithoutEquipment ?? 0) > 0 && (
                  <div className={styles.alertRow}>
                    <span><strong>{dashboard.counts.linesWithoutEquipment}</strong> linha(s) ativa(s) sem aparelho vinculado</span>
                    <Link href="/inventory/corporate-lines">Ver linhas</Link>
                  </div>
                )}
                {(dashboard.counts.peopleWithoutEquipment ?? 0) > 0 && (
                  <div className={styles.alertRow}>
                    <span><strong>{dashboard.counts.peopleWithoutEquipment}</strong> colaborador(es) sem nenhum equipamento</span>
                    <Link href="/inventory/people">Ver colaboradores</Link>
                  </div>
                )}
                {(dashboard.counts.expiringSoon ?? 0) > 0 && (
                  <div className={styles.alertRow}>
                    <span><strong>{dashboard.counts.expiringSoon}</strong> garantia(s) vencendo nos próximos 30 dias</span>
                    <Link href="/inventory/reports">Ver relatório</Link>
                  </div>
                )}
              </div>
            </section>
          )}

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <h2>Equipamentos por categoria</h2>
              <Link href="/inventory/reports">Ver relatórios</Link>
            </div>
            {dashboard.equipmentByCategory.length === 0 ? (
              <p className={styles.empty}>Nenhuma categoria cadastrada. <Link href="/inventory/settings">Adicionar categoria</Link></p>
            ) : (
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Quantidade</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.equipmentByCategory.map((category) => (
                      <tr key={category.id ?? category.category?.id ?? category.name}>
                        <td>{category.name ?? category.category?.name ?? 'Sem categoria'}</td>
                        <td>{category.count}</td>
                        <td>
                          {(category.id ?? category.category?.id) && (
                            <Link
                              href={`/inventory/equipment?categoryId=${category.id ?? category.category?.id}`}
                            >
                              Abrir
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={styles.card}>
            <h2>Movimentações recentes</h2>
            {dashboard.recentMovements.length === 0 ? (
              <p className={styles.empty}>Nenhuma movimentação registrada. <Link href="/inventory/equipment">Acessar equipamentos</Link></p>
            ) : (
              <ul className={styles.timeline}>
                {dashboard.recentMovements.map((movement) => (
                  <li key={movement.id}>
                    <div>
                      {movement.equipment ? (
                        <Link href={`/inventory/equipment/${movement.equipment.id}`}>
                          {equipmentLabel(movement.equipment)}
                        </Link>
                      ) : (
                        'Equipamento'
                      )}
                      {' · '}
                      {movement.fromPersonName || 'Estoque / sem responsável'} →{' '}
                      {movement.toPersonName || 'Estoque / sem responsável'}
                    </div>
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
        </>
      )}
    </div>
  )
}

function Metric({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'warning' }) {
  return (
    <div className={`${styles.metric}${tone === 'warning' ? ` ${styles.metricWarn}` : ''}`}>
      <span className={styles.metricLabel}>{label}</span>
      <strong className={styles.metricValue}>{value}</strong>
    </div>
  )
}

function StatusBadge({ status }: { status: EquipmentStatus }) {
  const tone = statusTone(status)
  return (
    <span className={`${styles.badge} ${tone === 'neutral' ? '' : styles[tone]}`}>
      {EQUIPMENT_STATUS_LABELS[status]}
    </span>
  )
}

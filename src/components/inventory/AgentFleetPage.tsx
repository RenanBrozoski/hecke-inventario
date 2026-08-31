'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { readApiError } from './format'
import { InventoryGate } from './InventoryGate'
import type { InventoryContextResponse } from './types'
import styles from './inventory.module.css'

interface AgentRow {
  id: string
  name: string
  serialNumber: string | null
  categoryName: string | null
  status: string
  syncedAt: string
  os: string | null
  ip: string | null
  anydeskId: string | null
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function hoursAgo(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
}

function agentStatus(syncedAt: string): { label: string; tone: string } {
  const h = hoursAgo(syncedAt)
  if (h < 6) return { label: 'Online', tone: 'success' }
  if (h < 24) return { label: 'Recente', tone: 'primary' }
  const d = daysSince(syncedAt)
  if (d < 7) return { label: 'Desatualizado', tone: 'warning' }
  return { label: 'Inativo', tone: 'danger' }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export function AgentFleetPage() {
  return <InventoryGate>{(ctx) => <FleetContent context={ctx} />}</InventoryGate>
}

function FleetContent({ context }: { context: InventoryContextResponse }) {
  const { authorizedFetch } = useSession()
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [wpUrl, setWpUrl] = useState('')
  const [wpStyle, setWpStyle] = useState('FILL')
  const [wpSaving, setWpSaving] = useState(false)
  const [wpResult, setWpResult] = useState<string | null>(null)
  const [wpError, setWpError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authorizedFetch('/api/inventory/agents')
      if (!res.ok) throw new Error(await readApiError(res, 'Erro ao carregar agentes.'))
      setAgents(((await res.json()) as { items: AgentRow[] }).items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido.')
    } finally {
      setLoading(false)
    }
  }, [authorizedFetch])

  useEffect(() => { void load() }, [load])

  const { onlineAgents, inactiveAgents } = useMemo(() => {
    const online: AgentRow[] = []
    const inactive: AgentRow[] = []
    for (const a of agents) {
      if (hoursAgo(a.syncedAt) < 24) online.push(a)
      if (daysSince(a.syncedAt) >= 7) inactive.push(a)
    }
    return { onlineAgents: online, inactiveAgents: inactive }
  }, [agents])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected(selected.size === agents.length ? new Set() : new Set(agents.map((a) => a.id)))
  }

  async function sendWallpaper(event: FormEvent) {
    event.preventDefault()
    setWpSaving(true)
    setWpResult(null)
    setWpError(null)
    try {
      const targetIds = selected.size > 0 ? Array.from(selected) : undefined
      const res = await authorizedFetch('/api/inventory/agents/wallpaper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: wpUrl.trim(), style: wpStyle, targetIds }),
      })
      if (!res.ok) throw new Error(await readApiError(res, 'Erro ao enviar wallpaper.'))
      const data = (await res.json()) as { queued: number; skipped: number }
      setWpResult(`Enviado para ${data.queued} agente(s). ${data.skipped > 0 ? `${data.skipped} sem agente ignorado(s).` : ''}`)
      setSelected(new Set())
    } catch (e) {
      setWpError(e instanceof Error ? e.message : 'Erro ao enviar.')
    } finally {
      setWpSaving(false)
    }
  }

  if (!context.canAdmin)
    return <p className="alert alert-error">Somente administradores podem ver os agentes.</p>

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <h1>Agentes de inventário</h1>
          <p className={styles.subtitle}>PCs com o agente instalado e comunicando com o sistema.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>Atualizar</button>
      </header>

      {error && <p className="alert alert-error">{error}</p>}

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <strong>{agents.length}</strong>
          <span>Total de agentes</span>
        </div>
        <div className={styles.statCard}>
          <strong className={styles.statOnline}>{onlineAgents.length}</strong>
          <span>Online (24h)</span>
        </div>
        <div className={styles.statCard}>
          <strong className={inactiveAgents.length > 0 ? styles.statInactive : ''}>{inactiveAgents.length}</strong>
          <span>Inativos (+7 dias)</span>
        </div>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Wallpaper corporativo</h2>
            <p className={styles.muted}>
              Selecione agentes na tabela abaixo para enviar a um grupo, ou deixe sem seleção para enviar a todos.
            </p>
          </div>
        </div>
        <form className={styles.wallpaperForm} onSubmit={sendWallpaper}>
          <div className={styles.field}>
            <label>URL da imagem</label>
            <input
              type="url"
              placeholder="https://..."
              value={wpUrl}
              onChange={(e) => setWpUrl(e.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <label>Ajuste</label>
            <select value={wpStyle} onChange={(e) => setWpStyle(e.target.value)}>
              <option value="FILL">Preencher</option>
              <option value="FIT">Ajustar</option>
              <option value="STRETCH">Esticar</option>
              <option value="TILE">Lado a lado</option>
              <option value="CENTER">Centralizar</option>
            </select>
          </div>
          <button type="submit" className="primary" disabled={wpSaving || !wpUrl.trim()}>
            {wpSaving
              ? 'Enviando…'
              : selected.size > 0
                ? `Enviar para ${selected.size} selecionado(s)`
                : 'Enviar para todos'}
          </button>
        </form>
        {wpResult && <p className="alert alert-success">{wpResult}</p>}
        {wpError && <p className="alert alert-error">{wpError}</p>}
      </section>

      {loading ? (
        <p className={styles.loading}>Carregando agentes…</p>
      ) : (
        <section className={styles.card}>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selected.size === agents.length && agents.length > 0}
                      onChange={toggleAll}
                      title="Selecionar todos"
                    />
                  </th>
                  <th>Status</th>
                  <th>Hostname</th>
                  <th>Categoria</th>
                  <th>Serial</th>
                  <th>SO</th>
                  <th>IP</th>
                  <th>AnyDesk</th>
                  <th>Último contato</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => {
                  const st = agentStatus(agent.syncedAt)
                  return (
                    <tr key={agent.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(agent.id)}
                          onChange={() => toggleSelect(agent.id)}
                        />
                      </td>
                      <td>
                        <span className={`badge badge-${st.tone}`}>{st.label}</span>
                      </td>
                      <td>
                        <Link href={`/inventory/equipment/${agent.id}`}>{agent.name}</Link>
                      </td>
                      <td>{agent.categoryName ?? '—'}</td>
                      <td className={styles.muted}>{agent.serialNumber ?? '—'}</td>
                      <td className={styles.muted}>{agent.os ?? '—'}</td>
                      <td className={styles.muted}>{agent.ip ?? '—'}</td>
                      <td className={styles.muted}>{agent.anydeskId ?? '—'}</td>
                      <td className={styles.muted} title={agent.syncedAt}>
                        {fmtDate(agent.syncedAt)}
                      </td>
                    </tr>
                  )
                })}
                {agents.length === 0 && (
                  <tr>
                    <td colSpan={9} className={styles.muted}>
                      Nenhum agente registrado. Instale o <code>inventory-agent.ps1</code> nos PCs.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

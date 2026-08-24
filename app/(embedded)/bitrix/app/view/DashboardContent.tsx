'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { MeResponse } from '@/src/components/session/SessionProvider'
import { useSession } from '@/src/components/session/SessionProvider'

interface SyncStatusResponse {
  syncStatus: string
  lastSyncAt: string | null
  lastSyncErrorAt: string | null
  lastSyncErrorMessage: string | null
  usersCount: number
  departmentsCount: number
}

const SYNC_STATUS_LABELS: Record<string, string> = {
  NEVER_RUN: 'Sincronização inicial pendente',
  PENDING: 'Sincronização inicial pendente',
  RUNNING: 'Sincronização em andamento',
  SUCCESS: 'Sincronização concluída',
  ERROR: 'Sincronização com erro',
}

function formatSyncStatus(status: string): string {
  return SYNC_STATUS_LABELS[status] ?? status
}

function isSyncPending(status: string): boolean {
  return status === 'NEVER_RUN' || status === 'PENDING' || status === 'RUNNING'
}

export function DashboardContent({ me }: { me: MeResponse }) {
  const { authorizedFetch } = useSession()
  const [sync, setSync] = useState<SyncStatusResponse | null>(null)
  const [triggeringSync, setTriggeringSync] = useState(false)

  const loadSync = useCallback(async () => {
    const response = await authorizedFetch('/api/bitrix/sync/status')
    if (response.ok) setSync((await response.json()) as SyncStatusResponse)
  }, [authorizedFetch])

  useEffect(() => {
    void loadSync()
  }, [loadSync])

  const handleManualSync = useCallback(async () => {
    setTriggeringSync(true)
    try {
      const response = await authorizedFetch('/api/bitrix/sync/trigger', { method: 'POST' })
      if (response.ok) await loadSync()
    } finally {
      setTriggeringSync(false)
    }
  }, [authorizedFetch, loadSync])

  const syncPending = sync ? isSyncPending(sync.syncStatus) : true

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Olá, {me.user.fullName.split(' ')[0]}</h1>
          <p style={{ color: 'var(--color-text-muted)' }}>
            {me.portal.domain} · instalação <span className="badge badge-success">{me.portal.status}</span>
          </p>
        </div>
        <Link href="/inventory" className="btn btn-primary">
          Abrir inventário
        </Link>
      </div>

      <div className="card">
        <h2>Diagnóstico da integração</h2>
        {sync ? (
          <table>
            <tbody>
              <tr>
                <td>Sincronização</td>
                <td>
                  <span className={`badge ${sync.syncStatus === 'SUCCESS' ? 'badge-success' : sync.syncStatus === 'ERROR' ? 'badge-danger' : 'badge-warning'}`}>
                    {formatSyncStatus(sync.syncStatus)}
                  </span>
                </td>
              </tr>
              <tr>
                <td>Usuários sincronizados</td>
                <td>{syncPending ? 'Aguardando sincronização' : sync.usersCount}</td>
              </tr>
              <tr>
                <td>Departamentos sincronizados</td>
                <td>{syncPending ? 'Aguardando sincronização' : sync.departmentsCount}</td>
              </tr>
              <tr>
                <td>Última sincronização</td>
                <td>{sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString('pt-BR') : 'nunca'}</td>
              </tr>
              {sync.syncStatus === 'ERROR' && sync.lastSyncErrorMessage && (
                <tr>
                  <td>Último erro</td>
                  <td className="alert alert-error" style={{ margin: 0 }}>
                    {sync.lastSyncErrorMessage}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <p style={{ color: 'var(--color-text-muted)' }}>Carregando status da sincronização…</p>
        )}

        {me.user.isAdmin && (
          <button type="button" className="primary" onClick={handleManualSync} disabled={triggeringSync} style={{ marginTop: 'var(--space-4)' }}>
            {triggeringSync ? 'Sincronizando…' : 'Sincronizar agora'}
          </button>
        )}
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { formatDateTime, readApiError } from './format'
import styles from './inventory.module.css'

export type InventoryAttachmentEntityType = 'EQUIPMENT' | 'PERSON' | 'TERM' | 'CUSTOM_RECORD'

interface AttachmentItem {
  id: string
  entityType: InventoryAttachmentEntityType
  entityId: string
  originalName: string
  contentType: string | null
  size: number
  description: string | null
  uploadedByName: string | null
  createdAt: string
}

const MAX_BYTES = 4 * 1024 * 1024
const ACCEPTED_EXTENSIONS = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv'

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function InventoryAttachments({
  entityType,
  entityId,
  canEdit,
  className,
}: {
  entityType: InventoryAttachmentEntityType
  entityId: string
  canEdit: boolean
  className?: string
}) {
  const { authorizedFetch } = useSession()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<AttachmentItem[]>([])
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ entityType, entityId })
      const response = await authorizedFetch(`/api/inventory/attachments?${params}`)
      if (!response.ok) {
        throw new Error(await readApiError(response, 'Não foi possível carregar os anexos.'))
      }
      const body = (await response.json()) as { items: AttachmentItem[] }
      setItems(body.items)
    } catch (cause) {
      setMessage({
        type: 'error',
        text: cause instanceof Error ? cause.message : 'Falha ao carregar os anexos.',
      })
    } finally {
      setLoading(false)
    }
  }, [authorizedFetch, entityId, entityType])

  useEffect(() => {
    void load()
  }, [load])

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = fileInputRef.current?.files?.[0]
    if (!file) {
      setMessage({ type: 'error', text: 'Selecione um arquivo.' })
      return
    }
    if (file.size > MAX_BYTES) {
      setMessage({ type: 'error', text: 'O arquivo excede o limite de 4 MB.' })
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const form = new FormData()
      form.set('entityType', entityType)
      form.set('entityId', entityId)
      form.set('description', description.trim())
      form.set('file', file)
      const response = await authorizedFetch('/api/inventory/attachments', {
        method: 'POST',
        body: form,
      })
      if (!response.ok) {
        throw new Error(await readApiError(response, 'Não foi possível anexar o arquivo.'))
      }
      setDescription('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      setMessage({ type: 'success', text: 'Arquivo anexado com sucesso.' })
      await load()
    } catch (cause) {
      setMessage({
        type: 'error',
        text: cause instanceof Error ? cause.message : 'Falha ao anexar o arquivo.',
      })
    } finally {
      setSaving(false)
    }
  }

  async function download(item: AttachmentItem) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const response = await authorizedFetch(`/api/inventory/attachments/${item.id}`)
      if (!response.ok) {
        throw new Error(await readApiError(response, 'Não foi possível baixar o anexo.'))
      }
      const objectUrl = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = item.originalName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (cause) {
      setMessage({
        type: 'error',
        text: cause instanceof Error ? cause.message : 'Falha ao baixar o anexo.',
      })
    } finally {
      setBusyId(null)
    }
  }

  async function remove(item: AttachmentItem) {
    if (!window.confirm(`Remover o anexo "${item.originalName}"?`)) return
    setBusyId(item.id)
    setMessage(null)
    try {
      const response = await authorizedFetch(`/api/inventory/attachments/${item.id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error(await readApiError(response, 'Não foi possível remover o anexo.'))
      }
      setMessage({ type: 'success', text: 'Anexo removido.' })
      await load()
    } catch (cause) {
      setMessage({
        type: 'error',
        text: cause instanceof Error ? cause.message : 'Falha ao remover o anexo.',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className={`${styles.card} ${className ?? ''}`}>
      <div className={styles.pageHeader} style={{ marginBottom: '0.75rem' }}>
        <h2>Anexos</h2>
        <span className={styles.badge}>{items.length}</span>
      </div>
      {message && (
        <p className={`alert ${message.type === 'error' ? 'alert-error' : 'alert-success'}`}>
          {message.text}
        </p>
      )}
      {loading ? (
        <p className={styles.loading}>Carregando anexos…</p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>Nenhum arquivo anexado.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Arquivo</th>
                <th>Tamanho</th>
                <th>Enviado em</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <button
                      type="button"
                      className={styles.linkButton}
                      disabled={busyId === item.id}
                      onClick={() => void download(item)}
                    >
                      {item.originalName}
                    </button>
                    {item.description && (
                      <div className={styles.timelineMeta}>{item.description}</div>
                    )}
                    {item.uploadedByName && (
                      <div className={styles.timelineMeta}>por {item.uploadedByName}</div>
                    )}
                  </td>
                  <td>{formatBytes(item.size)}</td>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void download(item)}
                      >
                        Baixar
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void remove(item)}
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <form onSubmit={upload} style={{ marginTop: '1rem' }}>
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label htmlFor={`attachment-${entityType}-${entityId}`}>Arquivo</label>
              <input
                id={`attachment-${entityType}-${entityId}`}
                ref={fileInputRef}
                type="file"
                name="file"
                accept={ACCEPTED_EXTENSIONS}
                required
              />
              <span className={styles.timelineMeta}>
                PDF, imagens, Office, TXT ou CSV · até 4 MB
              </span>
            </div>
            <div className={styles.field}>
              <label htmlFor={`attachment-description-${entityType}-${entityId}`}>Descrição</label>
              <input
                id={`attachment-description-${entityType}-${entityId}`}
                value={description}
                maxLength={500}
                placeholder="Ex.: nota fiscal ou termo assinado"
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? 'Enviando…' : 'Anexar arquivo'}
          </button>
        </form>
      )}
    </section>
  )
}

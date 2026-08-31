'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { InventoryGate } from './InventoryGate'
import { readApiError } from './format'
import styles from './inventory.module.css'
import Link from 'next/link'

type Person = { id: string; name: string; email: string | null; bitrixUserId: string | null }
type Pair = { a: Person; b: Person }

const DISMISSED_KEY = 'dedupe_dismissed_v1'

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveDismissed(set: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]))
  } catch { /* noop */ }
}

function pairKey(a: Person, b: Person): string {
  return [a.id, b.id].sort().join(':')
}

function DedupeContent() {
  const { authorizedFetch } = useSession()
  const [pairs, setPairs] = useState<Pair[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState<string | null>(null)

  useEffect(() => {
    setDismissed(loadDismissed())
  }, [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await authorizedFetch('/api/inventory/people/dedupe')
        if (!res.ok) throw new Error(await readApiError(res, 'Erro ao carregar candidatos.'))
        const data = (await res.json()) as { pairs: Pair[] }
        setPairs(data.pairs)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar candidatos.')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [authorizedFetch])

  const dismiss = useCallback((pair: Pair) => {
    const key = pairKey(pair.a, pair.b)
    setDismissed((prev) => {
      const next = new Set(prev)
      next.add(key)
      saveDismissed(next)
      return next
    })
  }, [])

  const merge = useCallback(async (winnerId: string, loserId: string, pair: Pair) => {
    const key = pairKey(pair.a, pair.b)
    setMerging(key)
    setError(null)
    try {
      const res = await authorizedFetch('/api/inventory/people/dedupe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winnerId, loserId }),
      })
      if (!res.ok) throw new Error(await readApiError(res, 'Erro ao mesclar.'))
      setPairs((prev) => prev.filter((p) => pairKey(p.a, p.b) !== key))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao mesclar.')
    } finally {
      setMerging(null)
    }
  }, [authorizedFetch])

  const visible = pairs.filter((p) => !dismissed.has(pairKey(p.a, p.b)))
  const dismissedCount = pairs.length - visible.length

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <div>
          <Link href="/inventory/people" className={styles.backLink}>← Colaboradores</Link>
          <h1>Verificar duplicatas</h1>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          {error}
          <button type="button" onClick={() => setError(null)} className={styles.errorBannerClose}>✕</button>
        </div>
      )}

      {loading && <p className={styles.loadingText}>Carregando candidatos…</p>}

      {!loading && visible.length === 0 && (
        <div className={styles.emptyCard}>
          <p>Nenhum candidato a duplicata encontrado.</p>
          {dismissedCount > 0 && (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                const next = new Set<string>()
                saveDismissed(next)
                setDismissed(next)
              }}
            >
              Mostrar {dismissedCount} par{dismissedCount !== 1 ? 'es' : ''} ignorado{dismissedCount !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}

      {!loading && visible.length > 0 && (
        <>
          <p className={styles.dedupeCount}>
            {visible.length} par{visible.length !== 1 ? 'es' : ''} candidato{visible.length !== 1 ? 's' : ''}.
            {dismissedCount > 0 && ` (${dismissedCount} ignorado${dismissedCount !== 1 ? 's' : ''})`}
          </p>
          <div className={styles.dedupeList}>
            {visible.map((pair) => {
              const key = pairKey(pair.a, pair.b)
              const isMerging = merging === key
              return (
                <div key={key} className={styles.dedupeCard}>
                  <div className={styles.dedupePeople}>
                    <PersonCard person={pair.a} />
                    <div className={styles.dedupeVs}>vs</div>
                    <PersonCard person={pair.b} />
                  </div>
                  <div className={styles.dedupeActions}>
                    <button
                      type="button"
                      disabled={isMerging || merging !== null}
                      onClick={() => void merge(pair.a.id, pair.b.id, pair)}
                      className={styles.dedupeKeepBtn}
                    >
                      {isMerging ? 'Mesclando…' : `Manter "${pair.a.name}"`}
                    </button>
                    <button
                      type="button"
                      disabled={isMerging || merging !== null}
                      onClick={() => void merge(pair.b.id, pair.a.id, pair)}
                      className={styles.dedupeKeepBtn}
                    >
                      {isMerging ? 'Mesclando…' : `Manter "${pair.b.name}"`}
                    </button>
                    <button
                      type="button"
                      disabled={merging !== null}
                      onClick={() => dismiss(pair)}
                      className={styles.dedupeDismissBtn}
                    >
                      São pessoas diferentes
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function PersonCard({ person }: { person: Person }) {
  return (
    <div className={styles.dedupePersonCard}>
      <div className={styles.dedupePersonName}>{person.name}</div>
      {person.email && <div className={styles.dedupePersonMeta}>{person.email}</div>}
      {person.bitrixUserId ? (
        <span className={styles.dedupeBadgeLinked}>Vinculado B24</span>
      ) : (
        <span className={styles.dedupeBadgeUnlinked}>Sem vínculo B24</span>
      )}
    </div>
  )
}

export function DedupePage() {
  return <InventoryGate><DedupeContent /></InventoryGate>
}

'use client'

import { useState, type FormEvent } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { readApiError } from './format'
import { InventoryGate } from './InventoryGate'
import styles from './inventory.module.css'

type PreviewRow = { id: string; kind: string; sheet: string; row: number; disposition: string; warnings: string[]; errors: string[]; sensitiveColumnsOmitted: string[] }
type Preview = { format: string; sheets: Array<{ name: string; rows: number; template: string }>; rows: PreviewRow[]; summary: Record<string, number> }

export function SpreadsheetImportPage() { return <InventoryGate>{(context) => context.canAdmin ? <ImportContent /> : <p className="alert alert-error">Somente administradores podem importar planilhas.</p>}</InventoryGate> }

function ImportContent() {
  const { authorizedFetch } = useSession()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [strategy, setStrategy] = useState<'review' | 'ignore' | 'update'>('review')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function send(endpoint: string, withStrategy = false) {
    if (!file) throw new Error('Selecione uma planilha.')
    const body = new FormData(); body.set('file', file); if (withStrategy) body.set('strategy', strategy)
    const response = await authorizedFetch(endpoint, { method: 'POST', body })
    if (!response.ok) throw new Error(await readApiError(response, 'Não foi possível processar a planilha.'))
    return response.json() as Promise<{ preview?: Preview; report?: { created: number; updated: number; skipped: number; totalRows: number } }>
  }
  async function previewFile(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setMessage(null)
    try { const result = await send('/api/inventory/imports/preview'); setPreview(result.preview ?? null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao gerar prévia.') } finally { setBusy(false) }
  }
  async function confirm() {
    setBusy(true); setError(null); setMessage(null)
    try { const result = await send('/api/inventory/imports/confirm', true); const report = result.report!; setMessage(`Importação concluída: ${report.created} criado(s), ${report.updated} atualizado(s) e ${report.skipped} ignorado(s), em ${report.totalRows} linha(s) analisada(s).`); setPreview(null); setFile(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao confirmar a importação.') } finally { setBusy(false) }
  }
  return <div>
    <header className={styles.pageHeader}><div><h1>Importar planilha</h1><p className={styles.subtitle}>XLSX ou CSV · a prévia não grava dados · colunas de senhas, tokens e credenciais são descartadas.</p></div></header>
    <form className={styles.card} onSubmit={previewFile}>
      <div className={styles.field}><label htmlFor="spreadsheet">Arquivo</label><input id="spreadsheet" type="file" accept=".xlsx,.csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setMessage(null) }} required /></div>
      <button className="primary" disabled={busy}>{busy ? 'Analisando…' : 'Detectar e gerar prévia'}</button>
    </form>
    {error && <p className="alert alert-error">{error}</p>}{message && <p className="alert alert-success">{message}</p>}
    {preview && <section className={styles.card} style={{ marginTop: '1rem' }}><h2>Prévia — {preview.format}</h2>
      <p>{preview.summary.CREATE ?? 0} novo(s) · {preview.summary.UPDATE ?? 0} possível(is) atualização(ões) · {preview.summary.REVIEW ?? 0} para revisão. Nenhum dado foi gravado.</p>
      <ul>{preview.sheets.map((sheet) => <li key={sheet.name}>{sheet.name}: {sheet.rows} linha(s), modelo {sheet.template}</li>)}</ul>
      <div className={styles.field}><label htmlFor="strategy">Ao confirmar</label><select id="strategy" value={strategy} onChange={(event) => setStrategy(event.target.value as typeof strategy)}><option value="review">Parar se houver conflito (recomendado)</option><option value="ignore">Ignorar conflitos e existentes</option><option value="update">Atualizar correspondências seguras</option></select></div>
      <div className={styles.tableWrap}><table><thead><tr><th>Origem</th><th>Tipo</th><th>Decisão</th><th>Avisos / conflitos</th></tr></thead><tbody>{preview.rows.slice(0, 200).map((row) => <tr key={row.id}><td>{row.sheet}:{row.row}</td><td>{row.kind}</td><td>{row.disposition}</td><td>{[...row.errors, ...row.warnings, ...(row.sensitiveColumnsOmitted.length ? ['Dados sensíveis omitidos.'] : [])].join(' ') || '—'}</td></tr>)}</tbody></table></div>
      {preview.rows.length > 200 && <p>Mostrando as primeiras 200 linhas da prévia.</p>}<button type="button" className="primary" onClick={() => void confirm()} disabled={busy}>{busy ? 'Importando…' : 'Confirmar importação'}</button>
    </section>}
  </div>
}

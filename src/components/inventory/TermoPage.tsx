'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useSession } from '@/src/components/session/SessionProvider'
import { EMPLOYMENT_TYPE_LABELS, EQUIPMENT_STATUS_LABELS } from './format'
import { InventoryGate } from './InventoryGate'
import type { EquipmentSummary, InventoryContextResponse, PersonDetail } from './types'
import styles from './inventory.module.css'

export function TermoPage({ personId }: { personId: string }) {
  return (
    <InventoryGate>
      {(context) => <TermoContent context={context} personId={personId} />}
    </InventoryGate>
  )
}

type TermoModel = 'CLT_HECKE' | 'PJ_HECKE' | 'CLT_MARKETMOVE' | 'PJ_MARKETMOVE'
const MODEL_LABELS: Record<TermoModel, string> = {
  CLT_HECKE: 'CLT — HECKE',
  PJ_HECKE: 'PJ — HECKE',
  CLT_MARKETMOVE: 'CLT — MarketMove',
  PJ_MARKETMOVE: 'PJ — MarketMove',
}

const EMPLOYER_CONFIGS = {
  HECKE: { name: 'HECKE REPRESENTAÇÕES COMERCIAIS LTDA', cnpj: '05.094.612/0001-04' },
  MARKETMOVE: { name: 'MARKETMOVE SERVIÇOS DE MERCHANDISING LTDA', cnpj: '58.301.921/0001-74' },
}

type ExtraEq = { category: string; description: string; patrimony: string; serialNumber: string }

function emptyExtraEq(): ExtraEq {
  return { category: '', description: '', patrimony: '', serialNumber: '' }
}

function eqFromSummary(eq: { category: { name: string }; name?: string | null; patrimony?: string | null; serialNumber?: string | null }): ExtraEq {
  return {
    category: eq.category.name,
    description: eq.name ?? '',
    patrimony: eq.patrimony ?? '',
    serialNumber: eq.serialNumber ?? '',
  }
}

function TermoContent({
  personId,
}: {
  context: InventoryContextResponse
  personId: string
}) {
  const { authorizedFetch } = useSession()
  const [person, setPerson] = useState<PersonDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState<TermoModel>('CLT_HECKE')
  const [cpf, setCpf] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [companyCnpj, setCompanyCnpj] = useState('')
  const [representativeName, setRepresentativeName] = useState('')
  const [representativeCpf, setRepresentativeCpf] = useState('')
  const [extraEquipment, setExtraEquipment] = useState<ExtraEq[]>([])
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  useEffect(() => {
    authorizedFetch(`/api/inventory/people/${personId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Erro ${r.status}`)
        return r.json() as Promise<PersonDetail>
      })
      .then((p) => { setPerson(p); if (p.cpf) setCpf(p.cpf) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Erro ao carregar'))
  }, [authorizedFetch, personId])

  const isPJ = model.startsWith('PJ')
  const isMarketMove = model.endsWith('MARKETMOVE')
  const employer = isMarketMove ? EMPLOYER_CONFIGS.MARKETMOVE : EMPLOYER_CONFIGS.HECKE
  const employerRole = isPJ ? 'CONTRATANTE' : 'EMPREGADOR'
  const employeeRole = isPJ ? 'CONTRATADO' : 'EMPREGADO'
  const contractLabel = isPJ ? 'contrato de prestação de serviços' : 'contrato de trabalho'

  function addExtraEq() {
    setExtraEquipment((prev) => [...prev, emptyExtraEq()])
  }

  function updateExtraEq(index: number, field: keyof ExtraEq, value: string) {
    setExtraEquipment((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    )
  }

  function removeExtraEq(index: number) {
    setExtraEquipment((prev) => prev.filter((_, i) => i !== index))
  }

  async function downloadDocx() {
    setDownloading(true)
    setDownloadError(null)
    try {
      const body: Record<string, unknown> = { model }
      if (!isPJ && cpf.trim()) body.cpf = cpf.trim()
      if (isPJ) {
        if (companyName.trim()) body.companyName = companyName.trim()
        if (companyCnpj.trim()) body.companyCnpj = companyCnpj.trim()
        if (representativeName.trim()) body.representativeName = representativeName.trim()
        if (representativeCpf.trim()) body.representativeCpf = representativeCpf.trim()
      }
      const validExtra = extraEquipment.filter(
        (e) => e.category.trim() || e.description.trim() || e.patrimony.trim(),
      )
      if (validExtra.length > 0) body.extraEquipment = validExtra
      const response = await authorizedFetch(`/api/inventory/people/${personId}/termo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Erro ${response.status}: ${text.slice(0, 200)}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const disposition = response.headers.get('Content-Disposition') ?? ''
      const match = /filename="([^"]+)"/.exec(disposition)
      a.href = url
      a.download = match?.[1] ?? 'termo.docx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'Falha ao gerar o documento.')
    } finally {
      setDownloading(false)
    }
  }

  if (error)
    return (
      <div className={styles.emptyState}>
        <p>{error}</p>
        <Link href={`/inventory/people/${personId}`}>← Voltar</Link>
      </div>
    )

  if (!person) return <div className={styles.emptyState}>Carregando...</div>

  const activeEquipment = (person.equipment ?? []).filter((e) => !e.archivedAt)
  const today = new Date().toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className={styles.termoPrintRoot}>
      <div className={`${styles.actions} ${styles.noPrint}`} style={{ marginBottom: '1.5rem' }}>
        <Link href={`/inventory/people/${personId}`}>
          <button type="button">← Voltar</button>
        </Link>
        <button type="button" onClick={() => window.print()}>
          Imprimir / Salvar PDF
        </button>
      </div>

      {/* DOCX download panel */}
      <div className={`${styles.card} ${styles.noPrint}`} style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.75rem' }}>Gerar Termo em DOCX</h3>
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label>Modelo</label>
            <select value={model} onChange={(e) => setModel(e.target.value as TermoModel)}>
              {Object.entries(MODEL_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          {!isPJ && (
            <div className={styles.field}>
              <label>CPF do colaborador</label>
              <input
                placeholder="000.000.000-00"
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
              />
            </div>
          )}
          {isPJ && (
            <>
              <div className={styles.field}>
                <label>Razão social da empresa</label>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>CNPJ da empresa</label>
                <input placeholder="00.000.000/0001-00" value={companyCnpj} onChange={(e) => setCompanyCnpj(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>Nome do representante legal</label>
                <input value={representativeName} onChange={(e) => setRepresentativeName(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>CPF do representante</label>
                <input placeholder="000.000.000-00" value={representativeCpf} onChange={(e) => setRepresentativeCpf(e.target.value)} />
              </div>
            </>
          )}
        </div>

        {/* Equipamentos extras */}
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <strong style={{ fontSize: '0.9rem' }}>Equipamentos adicionais</strong>
            <button type="button" onClick={addExtraEq} style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem' }}>
              + Manual
            </button>
            <ExistingEquipmentAdder onAdd={(eq) => setExtraEquipment((prev) => [...prev, eqFromSummary(eq)])} authorizedFetch={authorizedFetch} />
          </div>
          {extraEquipment.length === 0 && (
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #888)', margin: 0 }}>
              Nenhum equipamento adicional. O termo usará apenas os equipamentos vinculados ao colaborador.
            </p>
          )}
          {extraEquipment.map((eq, i) => (
            <div key={i} className={styles.formGrid} style={{ borderLeft: '2px solid var(--color-border, #444)', paddingLeft: '0.75rem', marginBottom: '0.5rem' }}>
              <div className={styles.field}>
                <label>Categoria</label>
                <input placeholder="Ex.: Desktop, Smartphone" value={eq.category} onChange={(e) => updateExtraEq(i, 'category', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>Descrição / Marca e Modelo</label>
                <input placeholder="Ex.: Dell Inspiron 15" value={eq.description} onChange={(e) => updateExtraEq(i, 'description', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>Cód. interno / TAG</label>
                <input placeholder="Ex.: PC099" value={eq.patrimony} onChange={(e) => updateExtraEq(i, 'patrimony', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>N/S · ID</label>
                <input placeholder="Número de série" value={eq.serialNumber} onChange={(e) => updateExtraEq(i, 'serialNumber', e.target.value)} />
              </div>
              <div className={styles.field} style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button type="button" onClick={() => removeExtraEq(i)} style={{ fontSize: '0.8rem', color: 'var(--color-danger, #d44)' }}>
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>

        {downloadError && <p className="alert alert-error" style={{ marginTop: '0.5rem' }}>{downloadError}</p>}
        <button
          type="button"
          className="primary"
          style={{ marginTop: '0.75rem' }}
          disabled={downloading}
          onClick={() => void downloadDocx()}
        >
          {downloading ? 'Gerando…' : 'Baixar DOCX'}
        </button>
      </div>

      <div className={styles.termoDocument}>
        <TermoDocument
          person={person}
          equipment={activeEquipment}
          today={today}
          employer={employer}
          employerRole={employerRole}
          employeeRole={employeeRole}
          contractLabel={contractLabel}
          extraEquipment={extraEquipment}
        />
      </div>
    </div>
  )
}

function ExistingEquipmentAdder({
  onAdd,
  authorizedFetch,
}: {
  onAdd: (eq: { category: { name: string }; name?: string | null; patrimony?: string | null; serialNumber?: string | null }) => void
  authorizedFetch: (input: string, init?: RequestInit) => Promise<Response>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ id: string; category: { name: string }; name?: string | null; patrimony?: string | null; serialNumber?: string | null }>>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    const timer = window.setTimeout(() => {
      void authorizedFetch(`/api/inventory/equipment?page=1&pageSize=20&q=${encodeURIComponent(query.trim())}`)
        .then(async (r) => r.ok ? r.json() : { items: [] })
        .then((d: { items?: typeof results }) => setResults(d.items ?? []))
        .catch(() => setResults([]))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [authorizedFetch, query])

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem' }}>
        + Buscar cadastrado
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        autoFocus
        placeholder="Busque por nome, patrimônio…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ minWidth: '220px', fontSize: '0.85rem', padding: '0.25rem 0.5rem' }}
      />
      {results.length > 0 && (
        <select
          size={1}
          onChange={(e) => {
            const found = results.find((r) => r.id === e.target.value)
            if (found) { onAdd(found); setOpen(false); setQuery('') }
          }}
          defaultValue=""
          style={{ fontSize: '0.85rem' }}
        >
          <option value="" disabled>Selecione…</option>
          {results.map((eq) => (
            <option key={eq.id} value={eq.id}>
              {[eq.category.name, eq.patrimony, eq.name].filter(Boolean).join(' – ')}
            </option>
          ))}
        </select>
      )}
      <button type="button" onClick={() => { setOpen(false); setQuery('') }} style={{ fontSize: '0.8rem' }}>✕</button>
    </div>
  )
}

function TermoDocument({
  person,
  equipment,
  today,
  employer,
  employerRole,
  employeeRole,
  contractLabel,
  extraEquipment,
}: {
  person: PersonDetail
  equipment: EquipmentSummary[]
  today: string
  employer: { name: string; cnpj: string }
  employerRole: string
  employeeRole: string
  contractLabel: string
  extraEquipment: ExtraEq[]
}) {
  const employmentLabel = person.employmentType
    ? EMPLOYMENT_TYPE_LABELS[person.employmentType]
    : null

  const allEquipment = [
    ...equipment.map((eq, i) => ({
      num: i + 1,
      category: eq.category.name,
      description: eq.name ?? '—',
      patrimony: eq.patrimony ?? '—',
      assetTag: eq.assetTag ?? '—',
      serialNumber: eq.serialNumber ?? '—',
      status: EQUIPMENT_STATUS_LABELS[eq.status],
    })),
    ...extraEquipment.map((eq, i) => ({
      num: equipment.length + i + 1,
      category: eq.category || '—',
      description: eq.description || '—',
      patrimony: eq.patrimony || '—',
      assetTag: '—',
      serialNumber: eq.serialNumber || '—',
      status: 'Ativo',
    })),
  ]

  return (
    <div className={styles.termoPage}>
      {/* Cabeçalho */}
      <div className={styles.termoHeader}>
        <p className={styles.termoCompanyName}>{employer.name}</p>
        <h1 className={styles.termoTitle}>
          TERMO DE RESPONSABILIDADE E AUTORIZAÇÃO DE ACESSO A DISPOSITIVOS CORPORATIVOS
        </h1>
      </div>

      {/* Partes */}
      <p className={styles.termoParagraph}>
        <strong>{employer.name}</strong>, pessoa jurídica de direito privado,
        inscrita no CNPJ sob nº <strong>{employer.cnpj}</strong>, adiante denominado
        simplesmente <em>{employerRole}</em>, e
      </p>
      <p className={styles.termoParagraph}>
        <strong>{person.name.toUpperCase()}</strong>
        {person.title ? `, ${person.title}` : ''}
        {person.department ? `, setor ${person.department.name}` : ''}
        {employmentLabel ? ` (${employmentLabel})` : ''}
        , doravante simplesmente designado <em>{employeeRole}</em>.
      </p>

      {/* Considerando */}
      <p className={styles.termoParagraph}>Considerando que:</p>
      <ol className={styles.termoList}>
        <li>
          A <em>{employerRole}</em> disponibiliza ao <em>{employeeRole}</em>, para fins exclusivamente
          profissionais, determinados equipamentos de sua propriedade;
        </li>
        <li>
          Os equipamentos poderão conter dados corporativos e estar conectados aos sistemas e
          informações sigilosas da <em>{employerRole}</em>;
        </li>
        <li>
          A Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 – LGPD) exige o
          consentimento do titular de dados para acesso a comunicações e informações armazenadas
          em dispositivos de uso pessoal ou compartilhado;
        </li>
      </ol>
      <p className={styles.termoParagraph}>
        As partes resolvem firmar o presente{' '}
        <strong>TERMO DE RESPONSABILIDADE E AUTORIZAÇÃO DE ACESSO</strong>, com as cláusulas e
        condições seguintes:
      </p>

      {/* Cláusula Primeira */}
      <p className={styles.termoClause}>
        <strong>Cláusula Primeira – DO OBJETO</strong>
      </p>
      <p className={styles.termoParagraph}>
        O presente instrumento tem por objeto a cessão, em caráter gratuito e temporário, de bens
        da <em>{employerRole}</em> ao <em>{employeeRole}</em> para o exercício de suas atividades
        profissionais.
      </p>

      <p className={styles.termoParagraph}>
        <strong>Equipamentos cedidos:</strong>
      </p>

      {/* Tabela de equipamentos */}
      <table className={styles.termoTable}>
        <thead>
          <tr>
            <th>N°</th>
            <th>Categoria</th>
            <th>Descrição / Marca&nbsp;&amp;&nbsp;Modelo</th>
            <th>Cód. interno</th>
            <th>TAG patrimonial</th>
            <th>N/S · ID</th>
            <th>Situação</th>
            <th>✓</th>
          </tr>
        </thead>
        <tbody>
          {allEquipment.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ textAlign: 'center', fontStyle: 'italic' }}>
                Nenhum equipamento cadastrado
              </td>
            </tr>
          ) : (
            allEquipment.map((eq) => (
              <tr key={eq.num}>
                <td>{eq.num}</td>
                <td>{eq.category}</td>
                <td>{eq.description}</td>
                <td>{eq.patrimony}</td>
                <td>{eq.assetTag}</td>
                <td>{eq.serialNumber}</td>
                <td>{eq.status}</td>
                <td>☐</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Cláusulas */}
      <p className={styles.termoClause}>
        <strong>Cláusula Segunda – DA RESPONSABILIDADE DO {employeeRole}</strong>
      </p>
      <p className={styles.termoParagraph}>
        O <em>{employeeRole}</em> compromete-se a utilizar os equipamentos exclusivamente para fins
        profissionais, responsabilizando-se pela guarda, conservação e devolução em perfeito
        estado de funcionamento. É vedada a cessão, empréstimo ou transferência dos equipamentos
        a terceiros.
      </p>

      <p className={styles.termoClause}>
        <strong>Cláusula Terceira – DO USO E DAS RESTRIÇÕES</strong>
      </p>
      <p className={styles.termoParagraph}>O <em>{employeeRole}</em> compromete-se a:</p>
      <ol className={styles.termoList}>
        <li>Utilizar os equipamentos exclusivamente no interesse das atividades profissionais;</li>
        <li>
          Não alterar senhas de acesso, nem formatar ou remover sistemas ou aplicativos sem
          autorização da <em>{employerRole}</em>;
        </li>
        <li>Não instalar aplicativos ou softwares não autorizados;</li>
        <li>
          Não utilizar os equipamentos para fins pessoais contínuos ou armazenar informações de
          natureza pessoal que comprometam a segurança da <em>{employerRole}</em>.
        </li>
      </ol>

      <p className={styles.termoClause}>
        <strong>Cláusula Quarta – DA AUTORIZAÇÃO DE ACESSO AOS DADOS</strong>
      </p>
      <p className={styles.termoParagraph}>
        Nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018), o <em>{employeeRole}</em>{' '}
        autoriza expressamente a <em>{employerRole}</em> a acessar, quando necessário, quaisquer
        informações armazenadas nos dispositivos corporativos por ele utilizados, incluindo, mas
        não se limitando a:
      </p>
      <ol className={styles.termoList}>
        <li>Mensagens de e-mail corporativo;</li>
        <li>
          Históricos de chamadas e mensagens via aplicativos como WhatsApp, Teams e similares;
        </li>
        <li>Arquivos, documentos, imagens e registros de navegação;</li>
        <li>Registros de uso dos sistemas e aplicativos instalados.</li>
      </ol>
      <p className={styles.termoParagraph}>
        Essa autorização visa exclusivamente à proteção dos interesses da <em>{employerRole}</em>, à
        prevenção de fraudes e à segurança da informação, respeitados os princípios da finalidade,
        necessidade, adequação, boa-fé e transparência previstos na LGPD.
      </p>

      <p className={styles.termoClause}>
        <strong>Cláusula Quinta – DA DEVOLUÇÃO</strong>
      </p>
      <p className={styles.termoParagraph}>
        O <em>{employeeRole}</em> compromete-se a devolver à <em>{employerRole}</em> todos os
        equipamentos recebidos imediatamente após:
      </p>
      <ol className={styles.termoList}>
        <li>O término do {contractLabel};</li>
        <li>Requisição formal da <em>{employerRole}</em>;</li>
        <li>Substituição ou troca de equipamento.</li>
      </ol>

      <p className={styles.termoClause}>
        <strong>Cláusula Sexta – DAS PENALIDADES</strong>
      </p>
      <p className={styles.termoParagraph}>
        O descumprimento das cláusulas aqui estabelecidas poderá ensejar sanções administrativas
        e disciplinares, inclusive rescisão do {contractLabel} por justa causa, quando
        aplicável, conforme previsto na legislação vigente.
      </p>

      <p className={styles.termoClause}>
        <strong>Cláusula Sétima – DISPOSIÇÕES GERAIS</strong>
      </p>
      <p className={styles.termoParagraph}>
        O presente termo entra em vigor na data de sua assinatura e é celebrado em duas vias de
        igual teor, ficando uma via com cada parte.
      </p>

      {/* Assinatura */}
      <p className={styles.termoSignatureCity}>Curitiba/PR, {today}</p>

      <div className={styles.termoSignatures}>
        <div className={styles.termoSignatureBlock}>
          <div className={styles.termoSignatureLine} />
          <p>{employer.name}</p>
          <p>
            <em>{employerRole}</em>
          </p>
        </div>
        <div className={styles.termoSignatureBlock}>
          <div className={styles.termoSignatureLine} />
          <p>{person.name.toUpperCase()}</p>
          <p>
            <em>{employeeRole}</em>
          </p>
        </div>
      </div>
    </div>
  )
}

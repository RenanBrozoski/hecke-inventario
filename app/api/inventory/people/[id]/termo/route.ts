import { NextResponse } from 'next/server'
import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  BorderStyle,
  UnderlineType,
} from 'docx'
import { z } from 'zod'
import {
  inventoryErrorResponse,
  parseJsonBody,
  requireInventoryContext,
} from '@/src/modules/inventory/http'
import { getPerson } from '@/src/modules/inventory/service'

export const dynamic = 'force-dynamic'

const extraEqSchema = z.object({
  category: z.string().trim().max(200).optional().default(''),
  description: z.string().trim().max(500).optional().default(''),
  patrimony: z.string().trim().max(200).optional().default(''),
  serialNumber: z.string().trim().max(200).optional().default(''),
})

const bodySchema = z.object({
  model: z.enum(['CLT_HECKE', 'PJ_HECKE', 'CLT_MARKETMOVE', 'PJ_MARKETMOVE']),
  cpf: z.string().trim().max(20).optional(),
  companyName: z.string().trim().max(300).optional(),
  companyCnpj: z.string().trim().max(30).optional(),
  representativeName: z.string().trim().max(300).optional(),
  representativeCpf: z.string().trim().max(20).optional(),
  extraEquipment: z.array(extraEqSchema).max(50).optional(),
})

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: Request, route: RouteContext) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const { id } = await route.params
    const body = bodySchema.parse(await parseJsonBody(request))

    const person = await getPerson(portalId, id)
    const activeEquipment = (person.equipment ?? []).filter((e) => !e.archivedAt)

    const isPJ = body.model.startsWith('PJ')
    const isMarketMove = body.model.endsWith('MARKETMOVE')

    const employer = isMarketMove
      ? { name: 'MARKETMOVE SERVIÇOS DE MERCHANDISING LTDA', cnpj: '58.301.921/0001-74' }
      : { name: 'HECKE REPRESENTAÇÕES COMERCIAIS LTDA', cnpj: '05.094.612/0001-04' }

    const employerRole = isPJ ? 'CONTRATANTE' : 'EMPREGADOR'
    const employeeRole = isPJ ? 'CONTRATADO' : 'EMPREGADO'

    const doc = buildDocx({
      employer,
      employerRole,
      employeeRole,
      isPJ,
      person: person as {
        name: string
        title?: string | null
        department?: { name: string } | null
        employmentType?: string | null
      },
      cpf: body.cpf,
      companyName: body.companyName,
      companyCnpj: body.companyCnpj,
      representativeName: body.representativeName,
      representativeCpf: body.representativeCpf,
      equipment: activeEquipment as Array<{
        category: { name: string }
        name?: string | null
        patrimony?: string | null
        assetTag?: string | null
        serialNumber?: string | null
        status: string
      }>,
      extraEquipment: body.extraEquipment ?? [],
    })

    const buffer = await Packer.toBuffer(doc)

    const safeName = person.name.replace(/[^a-zA-Z0-9À-ú\s]/g, '').trim().replace(/\s+/g, '_')
    const modelLabel = body.model.replace('_', '-')
    const filename = `Termo_${modelLabel}_${safeName}.docx`

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function bold(...text: string[]) {
  return text.map((t) => new TextRun({ text: t, bold: true }))
}

function italic(text: string) {
  return new TextRun({ text, italics: true })
}

function para(runs: (TextRun | string)[], opts?: { alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; spacing?: number }) {
  return new Paragraph({
    children: runs.map((r) => (typeof r === 'string' ? new TextRun(r) : r)),
    alignment: opts?.alignment,
    spacing: opts?.spacing !== undefined ? { before: opts.spacing, after: opts.spacing } : { before: 80, after: 80 },
  })
}

function clauseTitle(text: string) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true })],
    spacing: { before: 200, after: 80 },
  })
}

function bullet(text: string) {
  return new Paragraph({
    children: [new TextRun(text)],
    bullet: { level: 0 },
    spacing: { before: 40, after: 40 },
  })
}

function spacer() {
  return new Paragraph({ children: [new TextRun('')], spacing: { before: 60, after: 60 } })
}

function noBorder() {
  return { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
}

// ─── Document builder ────────────────────────────────────────────────────────

function buildDocx(opts: {
  employer: { name: string; cnpj: string }
  employerRole: string
  employeeRole: string
  isPJ: boolean
  person: { name: string; title?: string | null; department?: { name: string } | null; employmentType?: string | null }
  cpf?: string
  companyName?: string
  companyCnpj?: string
  representativeName?: string
  representativeCpf?: string
  equipment: Array<{
    category: { name: string }
    name?: string | null
    patrimony?: string | null
    assetTag?: string | null
    serialNumber?: string | null
    status: string
  }>
  extraEquipment: Array<{ category: string; description: string; patrimony: string; serialNumber: string }>
}) {
  const {
    employer, employerRole, employeeRole, isPJ,
    person, cpf, companyName, companyCnpj, representativeName, representativeCpf,
    equipment, extraEquipment,
  } = opts

  // ── Equipment table (4 cols: ITEM | MARCA/MODELO | N/S/ID/IMEI | CHECK) ──
  const allEq: Array<{ item: string; modelo: string; ns: string }> = [
    ...equipment.map((eq) => ({
      item: eq.category.name,
      modelo: [eq.name, eq.patrimony].filter(Boolean).join(' / '),
      ns: eq.serialNumber ?? '—',
    })),
    ...extraEquipment.map((eq) => ({
      item: eq.category || '—',
      modelo: [eq.description, eq.patrimony].filter(Boolean).join(' / ') || '—',
      ns: eq.serialNumber || '—',
    })),
  ]

  const W = { item: 30, modelo: 40, ns: 22, chk: 8 } as const
  const tc = (text: string, w: number, b = false, center = false) =>
    new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: b, size: 18 })], alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT })],
      width: { size: w, type: WidthType.PERCENTAGE },
    })

  const tableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        tc('ITEM', W.item, true),
        tc('MARCA / MODELO', W.modelo, true),
        tc('NÚMERO DE SÉRIE / ID / IMEI', W.ns, true),
        tc('CHECK (✓)', W.chk, true, true),
      ],
    }),
    ...(allEq.length === 0
      ? [new TableRow({
          children: [new TableCell({
            columnSpan: 4,
            children: [new Paragraph({ children: [new TextRun({ text: 'Nenhum equipamento cadastrado', italics: true })], alignment: AlignmentType.CENTER })],
            width: { size: 100, type: WidthType.PERCENTAGE },
          })],
        })]
      : allEq.map((r) => new TableRow({
          children: [
            tc(r.item, W.item),
            tc(r.modelo, W.modelo),
            tc(r.ns, W.ns),
            tc('☒', W.chk, false, true),
          ],
        }))),
  ]

  const equipmentTable = new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } })

  // ── Signature table ───────────────────────────────────────────────────────
  const sigName2 = isPJ ? (representativeName ?? person.name).toUpperCase() : person.name.toUpperCase()
  const signatureTable = new Table({
    rows: [
      new TableRow({
        children: [
          new TableCell({ borders: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' }, top: noBorder(), left: noBorder(), right: noBorder() }, children: [new Paragraph({ children: [new TextRun('')], spacing: { before: 600, after: 0 } })], width: { size: 45, type: WidthType.PERCENTAGE } }),
          new TableCell({ borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder() }, children: [new Paragraph({ children: [new TextRun('  ')] })], width: { size: 10, type: WidthType.PERCENTAGE } }),
          new TableCell({ borders: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' }, top: noBorder(), left: noBorder(), right: noBorder() }, children: [new Paragraph({ children: [new TextRun('')], spacing: { before: 600, after: 0 } })], width: { size: 45, type: WidthType.PERCENTAGE } }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder() },
            children: [
              new Paragraph({ children: [new TextRun({ text: employer.name, bold: true, size: 18 })], spacing: { before: 40, after: 0 } }),
              new Paragraph({ children: [italic(employerRole)], spacing: { before: 0, after: 0 } }),
            ],
            width: { size: 45, type: WidthType.PERCENTAGE },
          }),
          new TableCell({ borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder() }, children: [new Paragraph({ children: [] })], width: { size: 10, type: WidthType.PERCENTAGE } }),
          new TableCell({
            borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder() },
            children: [
              new Paragraph({ children: [new TextRun({ text: sigName2, bold: true, size: 18 })], spacing: { before: 40, after: 0 } }),
              ...(isPJ && representativeCpf ? [new Paragraph({ children: [new TextRun({ text: `CPF: ${representativeCpf}`, size: 18 })], spacing: { before: 0, after: 0 } })] : []),
              ...(!isPJ && cpf ? [new Paragraph({ children: [new TextRun({ text: `CPF: ${cpf}`, size: 18 })], spacing: { before: 0, after: 0 } })] : []),
              new Paragraph({ children: [italic(employeeRole)], spacing: { before: 0, after: 0 } }),
            ],
            width: { size: 45, type: WidthType.PERCENTAGE },
          }),
        ],
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
  })

  // ── Party texts ───────────────────────────────────────────────────────────
  const party1: (TextRun | string)[] = [
    new TextRun({ text: employer.name, bold: true, italics: true, underline: { type: UnderlineType.SINGLE } }),
    new TextRun(`, pessoa jurídica de direito privado, inscrita no CNPJ sob nº `),
    new TextRun(employer.cnpj),
    new TextRun(`, adiante denominado simplesmente `),
    new TextRun({ text: employerRole, bold: true, italics: true }),
    new TextRun(isPJ ? '; e' : ', e'),
  ]

  let party2: (TextRun | string)[]
  if (isPJ) {
    party2 = [
      new TextRun({ text: companyName ? companyName.toUpperCase() : '[NOME DA EMPRESA]', bold: true }),
      new TextRun(`, pessoa jurídica de direito privado, inscrita no CNPJ sob nº `),
      new TextRun(companyCnpj ?? '[CNPJ]'),
      new TextRun(`, neste ato representada pela sua representante legal, `),
      new TextRun(`${representativeName ? representativeName : '[REPRESENTANTE]'}`),
      ...(representativeCpf ? [new TextRun(`, inscrita no CPF sob n.º ${representativeCpf}`)] : []),
      new TextRun(`. doravante denominada, simplesmente, como `),
      new TextRun({ text: employeeRole, bold: true, italics: true }),
      new TextRun('.'),
    ]
  } else {
    party2 = [
      new TextRun({ text: person.name.toUpperCase(), bold: true }),
      new TextRun(`, inscrito no CPF sob nº `),
      new TextRun(cpf ?? '[CPF]'),
      new TextRun(`, doravante simplesmente designado `),
      new TextRun({ text: employeeRole, bold: true, italics: true }),
      new TextRun('.'),
    ]
  }

  // ── Clause texts: differ for CLT vs PJ ───────────────────────────────────
  const considerando = isPJ ? [
    bullet(`A ${employerRole} cede ao ${employeeRole}, a título gratuito, determinados dispositivos de sua propriedade, exclusivamente para a execução dos serviços contratados;`),
    bullet(`Os equipamentos podem conter ou acessar dados corporativos, sistemas internos e informações confidenciais da ${employerRole};`),
    bullet('A Lei nº 13.709/2018 (LGPD) exige autorização expressa do titular de dados para acesso a informações armazenadas em dispositivos de uso pessoal ou compartilhado;'),
  ] : [
    bullet(`A ${employerRole} disponibiliza ao ${employeeRole}, para fins exclusivamente profissionais, determinados equipamentos de sua propriedade;`),
    bullet(`Os equipamentos poderão conter dados corporativos e estar conectados aos sistemas e informações sigilosas da ${employerRole};`),
    bullet('A Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 – LGPD) exige o consentimento do titular de dados para acesso a comunicações e informações armazenadas em dispositivos de uso pessoal ou compartilhado;'),
  ]

  const introFirmar = isPJ
    ? [new TextRun('Celebram o presente '), ...bold('TERMO DE RESPONSABILIDADE E AUTORIZAÇÃO DE ACESSO'), new TextRun(', que se regerá pelas cláusulas e condições seguintes:')]
    : [new TextRun('As partes resolvem firmar o presente '), ...bold('TERMO DE RESPONSABILIDADE E AUTORIZAÇÃO DE ACESSO'), new TextRun(', com as cláusulas e condições seguintes:')]

  const clauseObjeto = isPJ
    ? `O presente termo tem por objeto a cessão, em caráter gratuito e temporário, de bens da ${employerRole} ao ${employeeRole} para fins exclusivamente profissionais, conforme quadro abaixo:`
    : `O presente instrumento tem por objeto a cessão, em caráter gratuito e temporário, de bens da ${employerRole} ao ${employeeRole} para o exercício de suas atividades profissionais.`

  const clauseSegunda = isPJ
    ? `O ${employeeRole} compromete-se a utilizar os equipamentos de forma exclusiva para a execução dos serviços profissionais, sendo responsável pela guarda, conservação e devolução dos itens em perfeito estado de funcionamento. É vedada a cessão, empréstimo, aluguel ou transferência dos equipamentos a terceiros, mesmo que integrantes da equipe do ${employeeRole}, sem autorização expressa da ${employerRole}.`
    : `O ${employeeRole} compromete-se a utilizar os equipamentos exclusivamente para fins profissionais, responsabilizando-se pela guarda, conservação e devolução em perfeito estado de funcionamento. É vedada a cessão, empréstimo ou transferência dos equipamentos a terceiros.`

  const clauseTerceiraIntro = isPJ ? `O ${employeeRole} se compromete a:` : `O ${employeeRole} compromete-se a:`
  const clauseTerceiraItems = isPJ ? [
    `Utilizar os equipamentos exclusivamente no interesse das atividades prestadas à ${employerRole};`,
    `Não alterar senhas de acesso, formatar dispositivos ou remover aplicativos sem prévia autorização da ${employerRole};`,
    'Não instalar softwares ou aplicativos não autorizados;',
    `Não utilizar os equipamentos para fins pessoais ou armazenar informações que possam comprometer a segurança da ${employerRole}.`,
  ] : [
    'Utilizar os equipamentos exclusivamente no interesse das atividades profissionais;',
    `Não alterar senhas de acesso, nem formatar ou remover sistemas ou aplicativos sem autorização da ${employerRole};`,
    'Não instalar aplicativos ou softwares não autorizados;',
    `Não utilizar os equipamentos para fins pessoais contínuos ou armazenar informações de natureza pessoal que comprometam a segurança da ${employerRole}.`,
  ]

  const clauseQuartaIntro = isPJ
    ? `Nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018), o ${employeeRole} autoriza expressamente a ${employerRole} a acessar, sempre que necessário, quaisquer dados e informações armazenadas nos dispositivos de sua titularidade cedidos temporariamente, incluindo, mas não se limitando a:`
    : `Nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018), o ${employeeRole} autoriza expressamente a ${employerRole} a acessar, quando necessário, quaisquer informações armazenadas nos dispositivos corporativos por ele utilizados, incluindo, mas não se limitando a:`
  const clauseQuartaItems = isPJ ? [
    'Mensagens de e-mail corporativo;',
    'Chamadas, mensagens e históricos em aplicativos de comunicação (ex: WhatsApp, Teams, Telegram etc.);',
    'Arquivos, documentos, imagens e registros de navegação;',
    'Registros de uso de sistemas, programas e aplicativos.',
  ] : [
    'Mensagens de e-mail corporativo;',
    'Históricos de chamadas e mensagens via aplicativos como WhatsApp, Teams e similares;',
    'Arquivos, documentos, imagens e registros de navegação;',
    'Registros de uso dos sistemas e aplicativos instalados.',
  ]
  const clauseQuartaFecho = isPJ
    ? `Essa autorização tem como finalidade a proteção de dados corporativos, segurança da informação e prevenção de riscos legais à ${employerRole}, observando-se os princípios da finalidade, necessidade, transparência e boa-fé previstos na LGPD.`
    : `Essa autorização visa exclusivamente à proteção dos interesses da ${employerRole}, à prevenção de fraudes e à segurança da informação, respeitados os princípios da finalidade, necessidade, adequação, boa-fé e transparência previstos na LGPD.`

  const clauseQuintaTitulo = isPJ ? 'Cláusula Quinta – DA DEVOLUÇÃO DOS EQUIPAMENTOS' : 'Cláusula Quinta – DA DEVOLUÇÃO'
  const clauseQuintaIntro = isPJ
    ? `O ${employeeRole} compromete-se a devolver os equipamentos cedidos:`
    : `O ${employeeRole} compromete-se a devolver à ${employerRole} todos os equipamentos recebidos imediatamente após:`
  const clauseQuintaItems = isPJ ? [
    'Ao término do contrato de prestação de serviços;',
    `Mediante solicitação formal da ${employerRole};`,
    'Em caso de substituição ou troca de equipamentos.',
  ] : [
    'O término do contrato de trabalho;',
    `Requisição formal da ${employerRole};`,
    'Substituição ou troca de equipamento.',
  ]

  const clauseSextaTitulo = isPJ ? 'Cláusula Sexta – DAS PENALIDADES E RESPONSABILIDADE CIVIL' : 'Cláusula Sexta – DAS PENALIDADES'
  const clauseSextaTexto = isPJ
    ? `A não devolução dos equipamentos ou sua devolução danificada, bem como o uso indevido ou a violação das cláusulas deste termo, ensejará a responsabilização do ${employeeRole} por perdas e danos, inclusive eventuais medidas judiciais cabíveis.`
    : `O descumprimento das cláusulas aqui estabelecidas poderá ensejar sanções administrativas e disciplinares, inclusive rescisão do contrato de trabalho por justa causa, quando aplicável, conforme previsto na legislação vigente.`

  const clauseSetimaTexto = isPJ
    ? 'Este termo entra em vigor na data de sua assinatura e é celebrado em duas vias de igual teor e forma, permanecendo uma com cada parte.'
    : 'O presente termo entra em vigor na data de sua assinatura e é celebrado em duas vias de igual teor, ficando uma via com cada parte.'

  const dateText = isPJ ? `Em ______ de ______________________ de 202___.` : `Curitiba/PR, ______, de ______________________, de 2026.`

  // ── Assemble document ─────────────────────────────────────────────────────
  const children = [
    new Paragraph({
      children: [new TextRun({ text: 'TERMO DE RESPONSABILIDADE E AUTORIZAÇÃO DE ACESSO A DISPOSITIVOS CORPORATIVOS', bold: true, size: 24 })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 300 },
    }),

    para(party1),
    para(party2),

    para(['Considerando que:']),
    ...considerando,
    para(introFirmar),

    clauseTitle('Cláusula Primeira – DO OBJETO'),
    para([clauseObjeto]),
    para([...bold('Equipamentos cedidos:')]),
    equipmentTable,
    spacer(),

    clauseTitle(`Cláusula Segunda – DA RESPONSABILIDADE DO ${employeeRole}`),
    para([clauseSegunda]),

    clauseTitle('Cláusula Terceira – DO USO E DAS RESTRIÇÕES'),
    para([clauseTerceiraIntro]),
    ...clauseTerceiraItems.map(bullet),

    clauseTitle('Cláusula Quarta – DA AUTORIZAÇÃO DE ACESSO AOS DADOS'),
    para([clauseQuartaIntro]),
    ...clauseQuartaItems.map(bullet),
    para([clauseQuartaFecho]),

    clauseTitle(clauseQuintaTitulo),
    para([clauseQuintaIntro]),
    ...clauseQuintaItems.map(bullet),

    clauseTitle(clauseSextaTitulo),
    para([clauseSextaTexto]),

    clauseTitle('Cláusula Sétima – DISPOSIÇÕES GERAIS'),
    para([clauseSetimaTexto]),

    spacer(),
    new Paragraph({
      children: [new TextRun(dateText)],
      alignment: AlignmentType.LEFT,
      spacing: { before: 200, after: 400 },
    }),
    signatureTable,
  ]

  return new Document({ sections: [{ properties: {}, children }] })
}

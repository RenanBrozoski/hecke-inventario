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

const bodySchema = z.object({
  model: z.enum(['CLT_HECKE', 'PJ_HECKE', 'CLT_MARKETMOVE', 'PJ_MARKETMOVE']),
  cpf: z.string().trim().max(20).optional(),
  companyName: z.string().trim().max(300).optional(),
  companyCnpj: z.string().trim().max(30).optional(),
  representativeName: z.string().trim().max(300).optional(),
  representativeCpf: z.string().trim().max(20).optional(),
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
      ? { name: 'MARKETMOVE COMUNICAÇÃO VISUAL LTDA', cnpj: '58.301.921/0001-74' }
      : { name: 'HECKE REPRESENTAÇÕES COMERCIAIS LTDA', cnpj: '05.094.612/0001-04' }

    const employerRole = isPJ ? 'CONTRATANTE' : 'EMPREGADOR'
    const employeeRole = isPJ ? 'CONTRATADO' : 'EMPREGADO'
    const contractLabel = isPJ ? 'contrato de prestação de serviços' : 'contrato de trabalho'

    const today = new Date().toLocaleDateString('pt-BR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

    const doc = buildDocx({
      employer,
      employerRole,
      employeeRole,
      contractLabel,
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
      today,
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
  contractLabel: string
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
  today: string
}) {
  const {
    employer, employerRole, employeeRole, contractLabel, isPJ,
    person, cpf, companyName, companyCnpj, representativeName, representativeCpf,
    equipment, today,
  } = opts

  const statusMap: Record<string, string> = {
    ACTIVE: 'Ativo', STOCK: 'Em estoque', MAINTENANCE: 'Em manutenção',
    BROKEN: 'Quebrado', LOANED: 'Emprestado', LOST: 'Extraviado', INACTIVE: 'Inativo',
  }

  // Equipment table
  const tableRows = [
    new TableRow({
      tableHeader: true,
      children: ['N°', 'Categoria', 'Descrição / Marca e Modelo', 'Cód. Interno', 'TAG', 'N/S · ID', 'Situação', '✓'].map(
        (h) =>
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18 })] })],
            width: { size: 100 / 8, type: WidthType.PERCENTAGE },
          }),
      ),
    }),
    ...(equipment.length === 0
      ? [
          new TableRow({
            children: [
              new TableCell({
                columnSpan: 8,
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: 'Nenhum equipamento cadastrado', italics: true })],
                    alignment: AlignmentType.CENTER,
                  }),
                ],
              }),
            ],
          }),
        ]
      : equipment.map(
          (eq, i) =>
            new TableRow({
              children: [
                String(i + 1),
                eq.category.name,
                eq.name ?? '—',
                eq.patrimony ?? '—',
                eq.assetTag ?? '—',
                eq.serialNumber ?? '—',
                statusMap[eq.status] ?? eq.status,
                '☐',
              ].map(
                (v) =>
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: v, size: 18 })] })],
                    width: { size: 100 / 8, type: WidthType.PERCENTAGE },
                  }),
              ),
            }),
        )),
  ]

  const equipmentTable = new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  })

  // Signature table
  const signatureTable = new Table({
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' }, top: noBorder(), left: noBorder(), right: noBorder() },
            children: [new Paragraph({ children: [new TextRun('')], spacing: { before: 600, after: 0 } })],
            width: { size: 45, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder() },
            children: [new Paragraph({ children: [new TextRun('     ')] })],
            width: { size: 10, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            borders: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' }, top: noBorder(), left: noBorder(), right: noBorder() },
            children: [new Paragraph({ children: [new TextRun('')], spacing: { before: 600, after: 0 } })],
            width: { size: 45, type: WidthType.PERCENTAGE },
          }),
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
          }),
          new TableCell({ borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder() }, children: [new Paragraph({ children: [] })] }),
          new TableCell({
            borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder() },
            children: [
              new Paragraph({
                children: [new TextRun({ text: isPJ ? (representativeName ?? person.name).toUpperCase() : person.name.toUpperCase(), bold: true, size: 18 })],
                spacing: { before: 40, after: 0 },
              }),
              ...(isPJ && representativeCpf
                ? [new Paragraph({ children: [new TextRun({ text: `CPF: ${representativeCpf}`, size: 18 })], spacing: { before: 0, after: 0 } })]
                : []),
              ...(cpf && !isPJ
                ? [new Paragraph({ children: [new TextRun({ text: `CPF: ${cpf}`, size: 18 })], spacing: { before: 0, after: 0 } })]
                : []),
              new Paragraph({ children: [italic(employeeRole)], spacing: { before: 0, after: 0 } }),
            ],
          }),
        ],
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
  })

  // Second party text
  let secondPartyText: (TextRun | string)[] = []
  if (isPJ) {
    secondPartyText = [
      ...bold(companyName ? companyName.toUpperCase() : '[NOME DA EMPRESA]'),
      new TextRun(`, pessoa jurídica inscrita no CNPJ sob nº `),
      ...bold(companyCnpj ?? '[CNPJ]'),
      new TextRun(`, representada neste ato por `),
      ...bold(representativeName ? representativeName.toUpperCase() : '[REPRESENTANTE]'),
      ...(representativeCpf ? [new TextRun(`, CPF nº `), ...bold(representativeCpf)] : []),
      new TextRun(`, doravante simplesmente designada `),
      italic(employeeRole),
      new TextRun('.'),
    ]
  } else {
    secondPartyText = [
      ...bold(person.name.toUpperCase()),
      ...(person.title ? [new TextRun(`, ${person.title}`)] : []),
      ...(person.department ? [new TextRun(`, setor ${person.department.name}`)] : []),
      ...(cpf ? [new TextRun(`, CPF nº `), ...bold(cpf)] : []),
      new TextRun(`, doravante simplesmente designado `),
      italic(employeeRole),
      new TextRun('.'),
    ]
  }

  const children = [
    // Title
    new Paragraph({
      children: [new TextRun({ text: employer.name, bold: true, size: 28, allCaps: true })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'TERMO DE RESPONSABILIDADE E AUTORIZAÇÃO DE ACESSO A DISPOSITIVOS CORPORATIVOS', bold: true, size: 24 })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 300 },
    }),

    // Parties
    para([
      ...bold(employer.name),
      new TextRun(`, pessoa jurídica de direito privado, inscrita no CNPJ sob nº `),
      ...bold(employer.cnpj),
      new TextRun(`, adiante denominado simplesmente `),
      italic(employerRole),
      new TextRun(', e'),
    ]),
    para(secondPartyText),

    // Considerando
    para(['Considerando que:']),
    bullet(`A empresa disponibiliza ao ${employeeRole}, para fins exclusivamente profissionais, determinados equipamentos de sua propriedade;`),
    bullet('Os equipamentos poderão conter dados corporativos e estar conectados aos sistemas e informações sigilosas da empresa;'),
    bullet('A Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 – LGPD) exige o consentimento do titular de dados para acesso a comunicações e informações armazenadas em dispositivos de uso pessoal ou compartilhado;'),
    para([
      new TextRun('As partes resolvem firmar o presente '),
      ...bold('TERMO DE RESPONSABILIDADE E AUTORIZAÇÃO DE ACESSO'),
      new TextRun(', com as cláusulas e condições seguintes:'),
    ]),

    // Cláusula 1
    clauseTitle('Cláusula Primeira – DO OBJETO'),
    para([`O presente instrumento tem por objeto a cessão, em caráter gratuito e temporário, de bens da empresa ao ${employeeRole} para o exercício de suas atividades profissionais.`]),
    para([...bold('Equipamentos cedidos:')]),
    equipmentTable,
    spacer(),

    // Cláusula 2
    clauseTitle(`Cláusula Segunda – DA RESPONSABILIDADE DO ${employeeRole}`),
    para([`O ${employeeRole} compromete-se a utilizar os equipamentos exclusivamente para fins profissionais, responsabilizando-se pela guarda, conservação e devolução em perfeito estado de funcionamento. É vedada a cessão, empréstimo ou transferência dos equipamentos a terceiros.`]),

    // Cláusula 3
    clauseTitle(`Cláusula Terceira – DO USO E DAS RESTRIÇÕES`),
    para([`O ${employeeRole} compromete-se a:`]),
    bullet('Utilizar os equipamentos exclusivamente no interesse das atividades profissionais;'),
    bullet('Não alterar senhas de acesso, nem formatar ou remover sistemas ou aplicativos sem autorização;'),
    bullet('Não instalar aplicativos ou softwares não autorizados;'),
    bullet(`Não utilizar os equipamentos para fins pessoais contínuos ou armazenar informações de natureza pessoal que comprometam a segurança da empresa.`),

    // Cláusula 4
    clauseTitle('Cláusula Quarta – DA AUTORIZAÇÃO DE ACESSO AOS DADOS'),
    para([`Nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018), o ${employeeRole} autoriza expressamente a empresa a acessar, quando necessário, quaisquer informações armazenadas nos dispositivos corporativos por ele utilizados, incluindo, mas não se limitando a:`]),
    bullet('Mensagens de e-mail corporativo;'),
    bullet('Históricos de chamadas e mensagens via aplicativos como WhatsApp, Teams e similares;'),
    bullet('Arquivos, documentos, imagens e registros de navegação;'),
    bullet('Registros de uso dos sistemas e aplicativos instalados.'),
    para(['Essa autorização visa exclusivamente à proteção dos interesses da empresa, à prevenção de fraudes e à segurança da informação, respeitados os princípios da finalidade, necessidade, adequação, boa-fé e transparência previstos na LGPD.']),

    // Cláusula 5
    clauseTitle('Cláusula Quinta – DA DEVOLUÇÃO'),
    para([`O ${employeeRole} compromete-se a devolver à empresa todos os equipamentos recebidos imediatamente após:`]),
    bullet(`O término do ${contractLabel};`),
    bullet('Requisição formal da empresa;'),
    bullet('Substituição ou troca de equipamento.'),

    // Cláusula 6
    clauseTitle('Cláusula Sexta – DAS PENALIDADES'),
    para([
      isPJ
        ? `O descumprimento das cláusulas aqui estabelecidas poderá ensejar sanções contratuais, inclusive rescisão do ${contractLabel} e reparação civil pelos danos causados.`
        : `O descumprimento das cláusulas aqui estabelecidas poderá ensejar sanções administrativas e disciplinares, inclusive rescisão do contrato de trabalho por justa causa, quando aplicável, conforme previsto na legislação vigente.`,
    ]),

    // Cláusula 7
    clauseTitle('Cláusula Sétima – DISPOSIÇÕES GERAIS'),
    para(['O presente termo entra em vigor na data de sua assinatura e é celebrado em duas vias de igual teor, ficando uma via com cada parte.']),

    spacer(),

    // Date
    new Paragraph({
      children: [new TextRun(`Curitiba/PR, ${today}`)],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 200, after: 400 },
    }),

    // Signatures
    signatureTable,
  ]

  return new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  })
}

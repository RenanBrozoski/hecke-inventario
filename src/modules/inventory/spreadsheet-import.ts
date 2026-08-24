import * as XLSX from 'xlsx'
import { normalizeCorporateLineNumber } from './corporate-line-service'

export type SpreadsheetImportKind = 'CORPORATE_LINE' | 'EQUIPMENT' | 'EXTENSION' | 'RECEIVING'
export type SpreadsheetImportDisposition = 'CREATE' | 'UPDATE' | 'REVIEW' | 'IGNORE'

export interface SpreadsheetImportRow {
  id: string
  kind: SpreadsheetImportKind
  sheet: string
  row: number
  payload: Record<string, string | null>
  disposition: SpreadsheetImportDisposition
  warnings: string[]
  errors: string[]
  sensitiveColumnsOmitted: string[]
}

export interface ParsedSpreadsheet {
  format: 'XLSX' | 'CSV'
  rows: SpreadsheetImportRow[]
  sheets: Array<{ name: string; rows: number; template: string }>
}

const SENSITIVE_HEADER = /(senha|password|secret|token|credencial|credential)/i
const CATEGORY_BY_SHEET: Record<string, string> = {
  desktop: 'Desktop',
  desktops: 'Desktop',
  notebook: 'Notebook',
  notebooks: 'Notebook',
  monitor: 'Monitor',
  monitores: 'Monitor',
  smartphone: 'Smartphone',
  smartphones: 'Smartphone',
  tablet: 'Tablet',
  tablets: 'Tablet',
  coletor: 'Coletor',
  coletores: 'Coletor',
  radio: 'Rádio',
  radios: 'Rádio',
  servidor: 'Servidor',
  servidores: 'Servidor',
}

export function normalizeImportText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
}

export function excelSerialDateToIso(value: number): string {
  if (!Number.isFinite(value) || value < 1 || value > 100_000) throw new Error('Data serial Excel inválida.')
  // Excel mantém o bug histórico de 1900 como bissexto; o epoch abaixo é o
  // padrão usado por bibliotecas modernas para converter o serial 1 em 1900-01-01.
  const utc = Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000)
  return new Date(utc).toISOString().slice(0, 10)
}

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') return Number.isInteger(value) && value > 20_000 && value < 100_000 ? excelSerialDateToIso(value) : String(value)
  return String(value).trim() || null
}

function valueFor(record: Record<string, string | null>, aliases: string[]): string | null {
  for (const alias of aliases) {
    const value = record[normalizeImportText(alias)]
    if (value) return value
  }
  return null
}

function recordFromRow(headers: string[], values: unknown[]) {
  const record: Record<string, string | null> = {}
  const sensitiveColumnsOmitted: string[] = []
  headers.forEach((header, index) => {
    if (!header) return
    if (SENSITIVE_HEADER.test(header)) {
      sensitiveColumnsOmitted.push(header)
      return
    }
    record[normalizeImportText(header)] = text(values[index])
  })
  return { record, sensitiveColumnsOmitted }
}

function lineRow(
  sheet: string,
  row: number,
  record: Record<string, string | null>,
  sensitiveColumnsOmitted: string[],
): SpreadsheetImportRow {
  const number = valueFor(record, ['número', 'numero', 'telefone', 'linha'])
  const errors: string[] = []
  let normalizedNumber: string | null = null
  if (!number) errors.push('Número da linha não informado.')
  else {
    try {
      normalizedNumber = normalizeCorporateLineNumber(number)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Número inválido.')
    }
  }
  return {
    id: `line:${normalizeImportText(sheet)}:${row}`,
    kind: 'CORPORATE_LINE',
    sheet,
    row,
    payload: {
      number,
      normalizedNumber,
      carrier: valueFor(record, ['operadora', 'carrier']),
      plan: valueFor(record, ['plano', 'plan']),
      dataAllowance: valueFor(record, ['dados', 'franquia', 'dados gb']),
      holderName: valueFor(record, ['titular', 'colaborador', 'responsável', 'responsavel', 'usuário', 'usuario']),
      notes: valueFor(record, ['observação', 'observacao', 'notas']),
    },
    disposition: errors.length ? 'REVIEW' : 'CREATE',
    warnings: sensitiveColumnsOmitted.length ? ['Colunas sensíveis foram ignoradas.'] : [],
    errors,
    sensitiveColumnsOmitted,
  }
}

function equipmentRow(
  sheet: string,
  row: number,
  category: string,
  record: Record<string, string | null>,
  sensitiveColumnsOmitted: string[],
): SpreadsheetImportRow {
  const patrimony = valueFor(record, ['patrimônio', 'patrimonio', 'código', 'codigo', 'pc', 'notebook', 'monitor', 'sm', 'coletor', 'coletores', 'rádio', 'radio', 'id'])
  const assetTag = valueFor(record, ['tag', 'nº patrimônio', 'no patrimonio', 'numero patrimonio', 'etiqueta'])
  const serialNumber = valueFor(record, ['série', 'serie', 'serial', 'número de série', 'numero de serie', 'n° de série'])
  const name = valueFor(record, ['nome', 'equipamento', 'modelo'])
  const warnings = sensitiveColumnsOmitted.length ? ['Colunas sensíveis foram ignoradas.'] : []
  if (!patrimony && !assetTag && !serialNumber) warnings.push('Sem patrimônio, etiqueta ou série para deduplicação segura.')
  return {
    id: `equipment:${normalizeImportText(sheet)}:${row}`,
    kind: 'EQUIPMENT',
    sheet,
    row,
    payload: {
      category,
      patrimony,
      assetTag,
      serialNumber,
      name,
      holderName: valueFor(record, ['responsável', 'responsavel', 'colaborador', 'colaboradores', 'usuário', 'usuario', 'titular']),
      departmentName: valueFor(record, ['setor', 'setores', 'departamento']),
      status: valueFor(record, ['situação', 'situacao', 'status']),
      receivedAt: valueFor(record, ['recebimento', 'data recebimento', 'data de recebimento', 'data de recbto', 'data de rec']),
      deliveredAt: valueFor(record, ['entrega', 'data entrega', 'data de entrega', 'data de ent']),
      notes: valueFor(record, ['observação', 'observacao', 'notas', 'obs', 'obs/situação', 'obs/situacao']),
      phone1: valueFor(record, ['telefone 1', 'telefone1', 'linha 1', 'n° de telefone 1°']),
      phone2: valueFor(record, ['telefone 2', 'telefone2', 'linha 2', 'n° de telefone 2']),
      phone3: valueFor(record, ['telefone 3', 'telefone3', 'linha 3', 'n° de telefone 3']),
    },
    disposition: patrimony || assetTag || serialNumber ? 'CREATE' : 'REVIEW',
    warnings,
    errors: patrimony || assetTag || serialNumber ? [] : ['Identificador do equipamento ausente.'],
    sensitiveColumnsOmitted,
  }
}

function lineFromEquipment(
  equipment: SpreadsheetImportRow,
  field: 'phone1' | 'phone2' | 'phone3',
): SpreadsheetImportRow | null {
  const number = equipment.payload[field]
  if (!number) return null
  const errors: string[] = []
  let normalizedNumber: string | null = null
  try {
    normalizedNumber = normalizeCorporateLineNumber(number)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Número inválido.')
  }
  return {
    id: `line-from-${equipment.id}:${field}`,
    kind: 'CORPORATE_LINE',
    sheet: equipment.sheet,
    row: equipment.row,
    payload: {
      number,
      normalizedNumber,
      holderName: equipment.payload.holderName ?? null,
      sourceEquipmentRowId: equipment.id,
      simSlot: field === 'phone1' ? 'SIM 1' : field === 'phone2' ? 'SIM 2' : 'SIM 3',
      carrier: null,
      plan: null,
      dataAllowance: null,
      notes: null,
    },
    disposition: errors.length ? 'REVIEW' : 'CREATE',
    warnings: ['Linha derivada da coluna de telefone do smartphone.'],
    errors,
    sensitiveColumnsOmitted: equipment.sensitiveColumnsOmitted,
  }
}

function ledgerRow(
  kind: 'EXTENSION' | 'RECEIVING',
  sheet: string,
  row: number,
  record: Record<string, string | null>,
  sensitiveColumnsOmitted: string[],
): SpreadsheetImportRow {
  return {
    id: `${kind.toLowerCase()}:${normalizeImportText(sheet)}:${row}`,
    kind,
    sheet,
    row,
    payload: record,
    disposition: 'CREATE',
    warnings: sensitiveColumnsOmitted.length ? ['Colunas sensíveis foram ignoradas.'] : [],
    errors: [],
    sensitiveColumnsOmitted,
  }
}

function templateForSheet(name: string, headers: string[]): string {
  const normalizedName = normalizeImportText(name)
  const normalizedHeaders = headers.map(normalizeImportText)
  if (normalizedHeaders.some((header) => header === 'numero' || header === 'número') && normalizedHeaders.some((header) => header === 'plano' || header === 'titular')) return 'corporate-lines'
  if (CATEGORY_BY_SHEET[normalizedName]) return `equipment:${CATEGORY_BY_SHEET[normalizedName]}`
  const categoryMatch = Object.entries(CATEGORY_BY_SHEET).find(([key]) => normalizedName.startsWith(key))
  if (categoryMatch) return `equipment:${categoryMatch[1]}`
  if (normalizedName.includes('ramal') || normalizedName.startsWith('ramai')) return 'extensions'
  if (normalizedName.includes('receb')) return 'receivings'
  return 'unknown'
}

export function parseSpreadsheet(bytes: Uint8Array, filename: string): ParsedSpreadsheet {
  const extension = filename.split('.').pop()?.toLowerCase()
  if (extension !== 'xlsx' && extension !== 'csv') throw new Error('Envie um arquivo XLSX ou CSV.')
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true, raw: true })
  const rows: SpreadsheetImportRow[] = []
  const sheets: ParsedSpreadsheet['sheets'] = []
  for (const name of workbook.SheetNames) {
    const values = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name]!, { header: 1, defval: null, raw: true })
    const headers = (values[0] ?? []).map((value) => text(value) ?? '')
    const template = templateForSheet(name, headers)
    let imported = 0
    for (let index = 1; index < values.length; index += 1) {
      const cells = values[index] ?? []
      if (cells.every((value) => value === null || value === undefined || String(value).trim() === '')) continue
      const { record, sensitiveColumnsOmitted } = recordFromRow(headers, cells)
      const row = index + 1
      if (template === 'corporate-lines') rows.push(lineRow(name, row, record, sensitiveColumnsOmitted))
      else if (template.startsWith('equipment:')) {
        const equipment = equipmentRow(name, row, template.slice('equipment:'.length), record, sensitiveColumnsOmitted)
        rows.push(equipment)
        if (normalizeImportText(equipment.payload.category ?? '') === 'smartphone') {
          const firstLine = lineFromEquipment(equipment, 'phone1')
          const secondLine = lineFromEquipment(equipment, 'phone2')
          const thirdLine = lineFromEquipment(equipment, 'phone3')
          if (firstLine) rows.push(firstLine)
          if (secondLine) rows.push(secondLine)
          if (thirdLine) rows.push(thirdLine)
        }
      }
      else if (template === 'extensions') rows.push(ledgerRow('EXTENSION', name, row, record, sensitiveColumnsOmitted))
      else if (template === 'receivings') rows.push(ledgerRow('RECEIVING', name, row, record, sensitiveColumnsOmitted))
      else continue
      imported += 1
    }
    sheets.push({ name, rows: imported, template })
  }
  return { format: extension === 'xlsx' ? 'XLSX' : 'CSV', rows, sheets }
}

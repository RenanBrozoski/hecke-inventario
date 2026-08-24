import { InventoryEquipmentStatus } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { createExtension, createReceiving } from './secondary-service'
import { createCorporateLine, updateCorporateLine } from './corporate-line-service'
import type { InventoryContext } from './http'
import { InventoryValidationError } from './http'
import { createEquipment, updateEquipment } from './service'
import { normalizeImportText, parseSpreadsheet, type SpreadsheetImportDisposition, type SpreadsheetImportRow } from './spreadsheet-import'

export type ImportConflictStrategy = 'ignore' | 'update' | 'review'

export interface SpreadsheetImportPreview {
  format: 'XLSX' | 'CSV'
  sheets: Array<{ name: string; rows: number; template: string }>
  rows: SpreadsheetImportRow[]
  summary: Record<SpreadsheetImportDisposition, number>
}

function exactMatches<T extends { id: string }>(values: T[], value: string | null, key: (item: T) => string | null) {
  if (!value) return []
  const normalized = normalizeImportText(value)
  return values.filter((item) => {
    const candidate = key(item)
    return candidate !== null && normalizeImportText(candidate) === normalized
  })
}

function equipmentStatus(value: string | null): InventoryEquipmentStatus {
  const normalized = normalizeImportText(value ?? '')
  if (['inativo', 'baixado', 'descartado'].includes(normalized)) return InventoryEquipmentStatus.INACTIVE
  if (['manutencao', 'em manutencao'].includes(normalized)) return InventoryEquipmentStatus.MAINTENANCE
  if (['estoque', 'disponivel'].includes(normalized)) return InventoryEquipmentStatus.STOCK
  if (['extraviado', 'perdido'].includes(normalized)) return InventoryEquipmentStatus.BROKEN
  return InventoryEquipmentStatus.ACTIVE
}

/** Enriquecimento somente de leitura: esta função jamais persiste o arquivo nem sua prévia. */
export async function previewSpreadsheetImport(
  portalId: string,
  bytes: Uint8Array,
  filename: string,
): Promise<SpreadsheetImportPreview> {
  const parsed = parseSpreadsheet(bytes, filename)
  const [people, equipment, categories, lines] = await Promise.all([
    prisma.inventoryPerson.findMany({ where: { portalId, archivedAt: null, status: { not: 'TERMINATED' } }, select: { id: true, name: true } }),
    prisma.inventoryEquipment.findMany({ where: { portalId, archivedAt: null }, select: { id: true, patrimony: true, assetTag: true, serialNumber: true, revision: true } }),
    prisma.inventoryCategory.findMany({ where: { portalId, active: true }, select: { id: true, name: true } }),
    prisma.inventoryCorporateLine.findMany({ where: { portalId, archivedAt: null }, select: { id: true, normalizedNumber: true, revision: true } }),
  ])
  const rows = parsed.rows.map((source) => {
    const row: SpreadsheetImportRow = { ...source, payload: { ...source.payload }, warnings: [...source.warnings], errors: [...source.errors] }
    const holder = exactMatches(people, row.payload.holderName ?? null, (person) => person.name)
    if (holder.length === 1) row.payload.holderId = holder[0]!.id
    else if ((row.payload.holderName ?? '') && holder.length > 1) {
      row.disposition = 'REVIEW'; row.errors.push('Titular ambíguo; o vínculo não será criado automaticamente.')
    } else if (row.payload.holderName) row.warnings.push('Titular não encontrado; a linha será importada sem vínculo.')

    if (row.kind === 'CORPORATE_LINE') {
      const existing = exactMatches(lines, row.payload.normalizedNumber ?? null, (line) => line.normalizedNumber)
      if (existing.length === 1) { row.disposition = 'UPDATE'; row.payload.existingLineId = existing[0]!.id; row.payload.existingRevision = String(existing[0]!.revision) }
      if (existing.length > 1) { row.disposition = 'REVIEW'; row.errors.push('Mais de uma linha existente corresponde ao número.') }
    }
    if (row.kind === 'EQUIPMENT') {
      const identifiers = [row.payload.patrimony, row.payload.assetTag, row.payload.serialNumber].filter((key): key is string => Boolean(key))
      const matches = equipment.filter((item) => identifiers.some((key) => [item.patrimony, item.assetTag, item.serialNumber].includes(key)))
      const category = exactMatches(categories, row.payload.category ?? null, (item) => item.name)
      if (category.length === 1) row.payload.categoryId = category[0]!.id
      else { row.disposition = 'REVIEW'; row.errors.push(`Categoria '${row.payload.category ?? 'não informada'}' não encontrada exatamente.`) }
      if (matches.length === 1) { row.disposition = 'UPDATE'; row.payload.existingEquipmentId = matches[0]!.id; row.payload.existingRevision = String(matches[0]!.revision) }
      if (matches.length > 1) { row.disposition = 'REVIEW'; row.errors.push('Equipamento ambíguo; não será atualizado automaticamente.') }
    }
    return row
  })
  const summary: Record<SpreadsheetImportDisposition, number> = { CREATE: 0, UPDATE: 0, REVIEW: 0, IGNORE: 0 }
  rows.forEach((row) => { summary[row.disposition] += 1 })
  return { format: parsed.format, sheets: parsed.sheets, rows, summary }
}

function optional(value: string | null | undefined) { return value?.trim() || null }

/**
 * Recalcula a prévia imediatamente antes de escrever. Assim o upload inicial
 * continua sem efeitos e nenhuma decisão é aplicada sobre dados desatualizados.
 */
export async function confirmSpreadsheetImport(
  context: InventoryContext,
  bytes: Uint8Array,
  filename: string,
  strategy: ImportConflictStrategy,
) {
  const preview = await previewSpreadsheetImport(context.portalId, bytes, filename)
  const pendingReview = preview.rows.filter((row) => row.disposition === 'REVIEW')
  if (strategy === 'review' && pendingReview.length) {
    throw new InventoryValidationError('A importação possui conflitos que exigem revisão.', pendingReview.map((row) => ({ id: row.id, sheet: row.sheet, row: row.row, errors: row.errors })))
  }
  const imported = { created: 0, updated: 0, skipped: 0, warnings: [] as string[] }
  const equipmentIds = new Map<string, string>()
  for (const row of preview.rows.filter((item) => item.kind === 'EQUIPMENT')) {
    if (row.disposition === 'REVIEW' || (row.disposition === 'UPDATE' && strategy !== 'update')) { imported.skipped += 1; continue }
    const input = {
      categoryId: row.payload.categoryId!, patrimony: optional(row.payload.patrimony), assetTag: optional(row.payload.assetTag),
      serialNumber: optional(row.payload.serialNumber), name: optional(row.payload.name), currentHolderId: optional(row.payload.holderId),
      status: equipmentStatus(row.payload.status ?? null), receivedAt: optional(row.payload.receivedAt), deliveredAt: optional(row.payload.deliveredAt), notes: optional(row.payload.notes), specs: {},
    }
    if (row.disposition === 'UPDATE') {
      const value = await updateEquipment(context, row.payload.existingEquipmentId!, { ...input, revision: Number(row.payload.existingRevision) }, 'IMPORT')
      equipmentIds.set(row.id, value.id); imported.updated += 1
    } else {
      const value = await createEquipment(context, input, 'IMPORT')
      equipmentIds.set(row.id, value.id); imported.created += 1
    }
  }
  for (const row of preview.rows.filter((item) => item.kind === 'CORPORATE_LINE')) {
    if (row.disposition === 'REVIEW' || (row.disposition === 'UPDATE' && strategy !== 'update')) { imported.skipped += 1; continue }
    const equipmentId = row.payload.sourceEquipmentRowId ? equipmentIds.get(row.payload.sourceEquipmentRowId) ?? null : null
    if (row.disposition === 'UPDATE') {
      await updateCorporateLine(context, row.payload.existingLineId!, {
        revision: Number(row.payload.existingRevision), number: row.payload.number!, carrier: optional(row.payload.carrier),
        plan: optional(row.payload.plan), dataAllowance: optional(row.payload.dataAllowance), currentHolderId: optional(row.payload.holderId),
        equipmentId, simSlot: optional(row.payload.simSlot), notes: optional(row.payload.notes),
      }, 'IMPORT')
      imported.updated += 1
      continue
    }
    await createCorporateLine(context, {
      number: row.payload.number!, carrier: optional(row.payload.carrier), plan: optional(row.payload.plan), dataAllowance: optional(row.payload.dataAllowance),
      currentHolderId: optional(row.payload.holderId), equipmentId, simSlot: optional(row.payload.simSlot), notes: optional(row.payload.notes), status: 'ACTIVE',
    }, 'IMPORT')
    imported.created += 1
  }
  for (const row of preview.rows.filter((item) => item.kind === 'EXTENSION' || item.kind === 'RECEIVING')) {
    if (row.disposition === 'REVIEW') { imported.skipped += 1; continue }
    if (row.kind === 'EXTENSION') await createExtension(context, { number: optional(row.payload.ramal) ?? optional(row.payload.numero) ?? optional(row.payload.number), collaborator: optional(row.payload.colaboradores) ?? optional(row.payload.colaborador), department: optional(row.payload.setor) ?? optional(row.payload.departamento), type: optional(row.payload.atendimento) ?? optional(row.payload.tipo), notes: optional(row.payload.observacao) })
    else await createReceiving(context, { receivedAt: optional(row.payload['data de recebimento']), equipment: optional(row.payload.equipamento), tag: optional(row.payload.tag), quantity: Number(row.payload.quantidade ?? 1) || 1, deliveredAt: optional(row.payload['data de entrega']), deliveredTo: optional(row.payload['entregue para:']), notes: optional(row.payload.observacao) })
    imported.created += 1
  }
  return { ...imported, totalRows: preview.rows.length, summary: preview.summary }
}

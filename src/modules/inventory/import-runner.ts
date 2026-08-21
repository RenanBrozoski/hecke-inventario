import { createHash } from 'crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  INVENTORY_LEGACY_SOURCE,
  LEGACY_ENUM_MAPS,
  type InventoryCounts,
  type InventoryExportDocument,
  type PreparedInventoryExport,
  parseLegacyDate,
  parseLegacyDateTime,
  parseOptions,
} from './import-format'
import {
  reconcileInventoryIdentities,
  type DepartmentReconciliation,
  type InventoryReconciliationPlan,
  type PersonReconciliation,
} from './import-reconciliation'

const AUTO_MATCH_METHODS = new Set([
  'normalized_name_unique',
  'email_exact_unique',
  'normalized_name_unique_department_confirmed',
])

export interface RunInventoryImportOptions {
  prisma: PrismaClient
  prepared: PreparedInventoryExport
  portalId: string
  mode: 'dry-run' | 'apply'
  allowNewSnapshot: boolean
  executedBy?: string
}

export interface InventoryImportExecutionReport {
  mode: 'dry-run' | 'apply'
  status: 'validated' | 'skipped' | 'imported'
  portalId: string
  source: string
  formatVersion: number
  rawSha256: string
  canonicalSha256: string
  existingRunId?: string
  counts: InventoryCounts
  skipped: { systemUsers: number; attachmentsWithoutBytes: number }
  sanitization: PreparedInventoryExport['sanitization']
  normalization: PreparedInventoryExport['normalization']
  warnings: string[]
  reconciliation: InventoryReconciliationPlan['summary']
  verification?: Record<string, number>
  importRunId?: string
}

export class InventoryImportSnapshotConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventoryImportSnapshotConflictError'
  }
}

export class InventoryImportTargetConflictError extends Error {
  constructor(
    message: string,
    public readonly conflicts: string[],
  ) {
    super(message)
    this.name = 'InventoryImportTargetConflictError'
  }
}

interface Inspection {
  skipRunId?: string
  reconciliation: InventoryReconciliationPlan
  report: InventoryImportExecutionReport
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

function dateOrUndefined(value: string | null | undefined): Date | undefined {
  return parseLegacyDateTime(value) ?? undefined
}

function deterministicAuditId(portalId: string, legacyId: number): string {
  const digest = createHash('sha256')
    .update(`${portalId}:${INVENTORY_LEGACY_SOURCE}:audit:${legacyId}`)
    .digest('hex')
    .slice(0, 32)
  return `inv_legacy_audit_${digest}`
}

function normalizeAction(value: string | null): string {
  const normalized = (value ?? 'unknown')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  return `inventory_legacy_${normalized || 'unknown'}`
}

function isManualMatch(existing: {
  bitrixMatchStatus: string
  bitrixMatchMethod: string | null
}): boolean {
  return (
    existing.bitrixMatchStatus === 'REJECTED' ||
    (existing.bitrixMatchStatus === 'MATCHED' && existing.bitrixMatchMethod === null) ||
    (existing.bitrixMatchMethod !== null && !AUTO_MATCH_METHODS.has(existing.bitrixMatchMethod))
  )
}

function departmentMatchData(
  proposed: DepartmentReconciliation,
  existing?: {
    bitrixDepartmentId: string | null
    bitrixMatchStatus: string
    bitrixMatchMethod: string | null
  },
): {
  bitrixDepartmentId: string | null
  bitrixMatchStatus: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'REJECTED'
  bitrixMatchMethod: string | null
} {
  if (existing && isManualMatch(existing)) {
    return {
      bitrixDepartmentId: existing.bitrixDepartmentId,
      bitrixMatchStatus: existing.bitrixMatchStatus as
        'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'REJECTED',
      bitrixMatchMethod: existing.bitrixMatchMethod,
    }
  }
  return {
    bitrixDepartmentId: proposed.bitrixDepartmentId,
    bitrixMatchStatus: proposed.status,
    bitrixMatchMethod: proposed.method,
  }
}

function personMatchData(
  proposed: PersonReconciliation,
  existing?: {
    bitrixUserId: string | null
    bitrixMatchStatus: string
    bitrixMatchMethod: string | null
  },
): {
  bitrixUserId: string | null
  bitrixMatchStatus: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'REJECTED'
  bitrixMatchMethod: string | null
} {
  if (existing && isManualMatch(existing)) {
    return {
      bitrixUserId: existing.bitrixUserId,
      bitrixMatchStatus: existing.bitrixMatchStatus as
        'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'REJECTED',
      bitrixMatchMethod: existing.bitrixMatchMethod,
    }
  }
  return {
    bitrixUserId: proposed.bitrixUserId,
    bitrixMatchStatus: proposed.status,
    bitrixMatchMethod: proposed.method,
  }
}

async function assertNoNaturalKeyConflicts(
  prisma: PrismaClient,
  portalId: string,
  document: InventoryExportDocument,
): Promise<void> {
  const [categories, departments, locations, modules, equipment] = await Promise.all([
    prisma.inventoryCategory.findMany({
      where: { portalId, name: { in: document.categorias.map((item) => item.nome) } },
      select: { name: true, legacySource: true, legacyId: true },
    }),
    prisma.inventoryDepartment.findMany({
      where: { portalId, name: { in: document.setores.map((item) => item.nome) } },
      select: { name: true, legacySource: true, legacyId: true },
    }),
    prisma.inventoryLocation.findMany({
      where: { portalId, name: { in: document.locais.map((item) => item.nome) } },
      select: { name: true, legacySource: true, legacyId: true },
    }),
    prisma.inventoryCustomModule.findMany({
      where: { portalId, name: { in: document.abas_personalizadas.map((item) => item.nome) } },
      select: { name: true, legacySource: true, legacyId: true },
    }),
    prisma.inventoryEquipment.findMany({
      where: {
        portalId,
        patrimony: {
          in: document.equipamentos.flatMap((item) => (item.patrimonio ? [item.patrimonio] : [])),
        },
      },
      select: { patrimony: true, legacySource: true, legacyId: true },
    }),
  ])
  const conflicts: string[] = []
  const check = <
    TTarget extends { legacySource: string | null; legacyId: number | null },
    TSource extends { id: number },
  >(
    target: TTarget[],
    source: TSource[],
    targetKey: (item: TTarget) => string | null,
    sourceKey: (item: TSource) => string | null,
    label: string,
  ) => {
    for (const existing of target) {
      const key = targetKey(existing)
      const expected = source.find((item) => sourceKey(item) === key)
      if (
        !expected ||
        existing.legacySource !== INVENTORY_LEGACY_SOURCE ||
        existing.legacyId !== expected.id
      ) {
        conflicts.push(`${label}: chave natural já pertence a outro registro no portal.`)
      }
    }
  }
  check(
    categories,
    document.categorias,
    (item) => item.name,
    (item) => item.nome,
    'categoria',
  )
  check(
    departments,
    document.setores,
    (item) => item.name,
    (item) => item.nome,
    'setor',
  )
  check(
    locations,
    document.locais,
    (item) => item.name,
    (item) => item.nome,
    'local',
  )
  check(
    modules,
    document.abas_personalizadas,
    (item) => item.name,
    (item) => item.nome,
    'módulo personalizado',
  )
  check(
    equipment,
    document.equipamentos,
    (item) => item.patrimony,
    (item) => item.patrimonio,
    'patrimônio',
  )

  const [existingCategoryParents, existingModuleParents] = await Promise.all([
    prisma.inventoryCategory.findMany({
      where: {
        portalId,
        legacySource: INVENTORY_LEGACY_SOURCE,
        legacyId: { in: document.categorias.map((item) => item.id) },
      },
      select: { id: true, legacyId: true },
    }),
    prisma.inventoryCustomModule.findMany({
      where: {
        portalId,
        legacySource: INVENTORY_LEGACY_SOURCE,
        legacyId: { in: document.abas_personalizadas.map((item) => item.id) },
      },
      select: { id: true, legacyId: true },
    }),
  ])
  const sourceCategoryByTargetId = new Map(
    existingCategoryParents.map((parent) => [
      parent.id,
      document.categorias.find((item) => item.id === parent.legacyId)!,
    ]),
  )
  const sourceModuleByTargetId = new Map(
    existingModuleParents.map((parent) => [
      parent.id,
      document.abas_personalizadas.find((item) => item.id === parent.legacyId)!,
    ]),
  )
  const [existingFields, existingModuleFields] = await Promise.all([
    sourceCategoryByTargetId.size === 0
      ? Promise.resolve([])
      : prisma.inventoryField.findMany({
          where: {
            portalId,
            OR: [...sourceCategoryByTargetId.entries()].map(([categoryId, category]) => ({
              categoryId,
              key: { in: category.campos.map((field) => field.chave) },
            })),
          },
          select: { categoryId: true, key: true, legacySource: true, legacyId: true },
        }),
    sourceModuleByTargetId.size === 0
      ? Promise.resolve([])
      : prisma.inventoryCustomModuleField.findMany({
          where: {
            portalId,
            OR: [...sourceModuleByTargetId.entries()].map(([moduleId, customModule]) => ({
              moduleId,
              key: { in: customModule.campos.map((field) => field.chave) },
            })),
          },
          select: { moduleId: true, key: true, legacySource: true, legacyId: true },
        }),
  ])
  for (const existing of existingFields) {
    const expected = sourceCategoryByTargetId
      .get(existing.categoryId)
      ?.campos.find((field) => field.chave === existing.key)
    if (
      !expected ||
      existing.legacySource !== INVENTORY_LEGACY_SOURCE ||
      existing.legacyId !== expected.id
    ) {
      conflicts.push(`campo de categoria ${existing.key}: chave já pertence a outro registro.`)
    }
  }
  for (const existing of existingModuleFields) {
    const expected = sourceModuleByTargetId
      .get(existing.moduleId)
      ?.campos.find((field) => field.chave === existing.key)
    if (
      !expected ||
      existing.legacySource !== INVENTORY_LEGACY_SOURCE ||
      existing.legacyId !== expected.id
    ) {
      conflicts.push(`campo de módulo ${existing.key}: chave já pertence a outro registro.`)
    }
  }
  if (conflicts.length > 0)
    throw new InventoryImportTargetConflictError(
      'Há colisões com dados já existentes no destino.',
      conflicts,
    )
}

async function inspectImport(options: RunInventoryImportOptions): Promise<Inspection> {
  const { prisma, portalId, prepared, allowNewSnapshot } = options
  const portal = await prisma.bitrixPortal.findUnique({
    where: { id: portalId },
    select: { id: true },
  })
  if (!portal) throw new Error(`Portal explícito não encontrado: ${portalId}.`)

  const successfulRuns = await prisma.inventoryImportRun.findMany({
    where: { portalId, source: INVENTORY_LEGACY_SOURCE, status: 'SUCCESS' },
    orderBy: { finishedAt: 'desc' },
    select: { id: true, rawSha256: true, canonicalSha256: true },
  })
  const identical = successfulRuns.find(
    (run) =>
      run.rawSha256 === prepared.rawSha256 || run.canonicalSha256 === prepared.canonicalSha256,
  )
  if (!identical && successfulRuns.length > 0 && !allowNewSnapshot) {
    throw new InventoryImportSnapshotConflictError(
      'Já existe outro snapshot concluído para este portal. Revise o corte e use --allow-new-snapshot conscientemente.',
    )
  }

  if (!identical) await assertNoNaturalKeyConflicts(prisma, portalId, prepared.document)
  const [bitrixDepartments, bitrixUsers] = await Promise.all([
    prisma.bitrixDepartment.findMany({
      where: { portalId, active: true },
      select: { bitrixDepartmentId: true, name: true, active: true },
    }),
    prisma.bitrixUser.findMany({
      where: { portalId, active: true },
      select: {
        bitrixUserId: true,
        fullName: true,
        email: true,
        departmentIds: true,
        active: true,
      },
    }),
  ])
  const reconciliation = reconcileInventoryIdentities(
    prepared.document,
    bitrixDepartments,
    bitrixUsers,
  )
  const report: InventoryImportExecutionReport = {
    mode: options.mode,
    status: identical ? 'skipped' : options.mode === 'dry-run' ? 'validated' : 'imported',
    portalId,
    source: INVENTORY_LEGACY_SOURCE,
    formatVersion: prepared.document._meta.versao,
    rawSha256: prepared.rawSha256,
    canonicalSha256: prepared.canonicalSha256,
    existingRunId: identical?.id,
    counts: prepared.counts,
    skipped: {
      systemUsers: prepared.counts.users,
      attachmentsWithoutBytes: prepared.counts.attachments,
    },
    sanitization: prepared.sanitization,
    normalization: prepared.normalization,
    warnings: prepared.warnings,
    reconciliation: reconciliation.summary,
  }
  return { skipRunId: identical?.id, reconciliation, report }
}

interface ImportedMaps {
  categories: Map<number, string>
  departments: Map<number, string>
  locations: Map<number, string>
  people: Map<number, string>
  equipment: Map<number, string>
  modules: Map<number, string>
  records: Map<number, string>
  terms: Map<number, string>
}

function missingLegacyRows(portalId: string, legacyIds: number[]) {
  return {
    portalId,
    legacySource: INVENTORY_LEGACY_SOURCE,
    legacyId: legacyIds.length > 0 ? { notIn: legacyIds } : { not: null },
  }
}

/**
 * Um corte novo representa o estado atual da fonte. Entidades mutáveis que
 * desapareceram são desativadas/arquivadas, nunca apagadas; movimentos,
 * auditoria e termos permanecem append-only por retenção histórica/legal.
 */
async function archiveLegacyRowsMissingFromSnapshot(
  tx: Prisma.TransactionClient,
  portalId: string,
  document: InventoryExportDocument,
): Promise<void> {
  const archivedAt = new Date()
  const categoryIds = document.categorias.map((item) => item.id)
  const fieldIds = document.categorias.flatMap((item) => item.campos.map((field) => field.id))
  const moduleIds = document.abas_personalizadas.map((item) => item.id)
  const moduleFieldIds = document.abas_personalizadas.flatMap((item) =>
    item.campos.map((field) => field.id),
  )
  const recordIds = document.abas_personalizadas.flatMap((item) =>
    item.registros.map((record) => record.id),
  )

  await Promise.all([
    tx.inventoryEquipment.updateMany({
      where: missingLegacyRows(
        portalId,
        document.equipamentos.map((item) => item.id),
      ),
      data: { archivedAt, revision: { increment: 1 } },
    }),
    tx.inventoryPerson.updateMany({
      where: missingLegacyRows(
        portalId,
        document.colaboradores.map((item) => item.id),
      ),
      data: { archivedAt, status: 'TERMINATED', revision: { increment: 1 } },
    }),
    tx.inventoryExtension.updateMany({
      where: missingLegacyRows(
        portalId,
        document.ramais.map((item) => item.id),
      ),
      data: { archivedAt, active: false },
    }),
    tx.inventoryReceiving.updateMany({
      where: missingLegacyRows(
        portalId,
        document.recebimentos.map((item) => item.id),
      ),
      data: { archivedAt },
    }),
    tx.inventoryCustomRecord.updateMany({
      where: missingLegacyRows(portalId, recordIds),
      data: { archivedAt, revision: { increment: 1 } },
    }),
    tx.inventoryField.updateMany({
      where: missingLegacyRows(portalId, fieldIds),
      data: { active: false },
    }),
    tx.inventoryCustomModuleField.updateMany({
      where: missingLegacyRows(portalId, moduleFieldIds),
      data: { active: false },
    }),
    tx.inventoryCategory.updateMany({
      where: missingLegacyRows(portalId, categoryIds),
      data: { active: false, revision: { increment: 1 } },
    }),
    tx.inventoryDepartment.updateMany({
      where: missingLegacyRows(
        portalId,
        document.setores.map((item) => item.id),
      ),
      data: { active: false },
    }),
    tx.inventoryLocation.updateMany({
      where: missingLegacyRows(
        portalId,
        document.locais.map((item) => item.id),
      ),
      data: { active: false },
    }),
    tx.inventoryCustomModule.updateMany({
      where: missingLegacyRows(portalId, moduleIds),
      data: { active: false, revision: { increment: 1 } },
    }),
  ])
}

async function importDocument(
  tx: Prisma.TransactionClient,
  portalId: string,
  prepared: PreparedInventoryExport,
  reconciliation: InventoryReconciliationPlan,
): Promise<ImportedMaps> {
  const document = prepared.document
  const source = INVENTORY_LEGACY_SOURCE
  const maps: ImportedMaps = {
    categories: new Map(),
    departments: new Map(),
    locations: new Map(),
    people: new Map(),
    equipment: new Map(),
    modules: new Map(),
    records: new Map(),
    terms: new Map(),
  }

  for (const category of document.categorias) {
    const data = {
      name: category.nome,
      prefix: category.prefixo,
      icon: category.icone ?? 'box-seam',
      description: category.descricao,
      sortOrder: category.ordem ?? 100,
      active: true,
    }
    const target = await tx.inventoryCategory.upsert({
      where: {
        portalId_legacySource_legacyId: { portalId, legacySource: source, legacyId: category.id },
      },
      create: { portalId, legacySource: source, legacyId: category.id, ...data },
      update: { ...data, revision: { increment: 1 } },
      select: { id: true },
    })
    maps.categories.set(category.id, target.id)
    for (const field of category.campos) {
      const fieldData = {
        categoryId: target.id,
        key: field.chave,
        label: field.rotulo,
        type: LEGACY_ENUM_MAPS.fieldType[field.tipo],
        options: parseOptions(field.opcoes),
        sortOrder: field.ordem ?? 100,
        required: field.obrigatorio,
        listVisible: field.mostrar_na_lista,
        active: true,
      }
      await tx.inventoryField.upsert({
        where: {
          portalId_legacySource_legacyId: { portalId, legacySource: source, legacyId: field.id },
        },
        create: { portalId, legacySource: source, legacyId: field.id, ...fieldData },
        update: fieldData,
      })
    }
  }

  const existingDepartments = await tx.inventoryDepartment.findMany({
    where: {
      portalId,
      legacySource: source,
      legacyId: { in: document.setores.map((item) => item.id) },
    },
    select: {
      legacyId: true,
      bitrixDepartmentId: true,
      bitrixMatchStatus: true,
      bitrixMatchMethod: true,
    },
  })
  const existingDepartmentByLegacyId = new Map(
    existingDepartments.map((item) => [item.legacyId!, item]),
  )
  for (const department of document.setores) {
    const match = departmentMatchData(
      reconciliation.departments.get(department.id)!,
      existingDepartmentByLegacyId.get(department.id),
    )
    const data = {
      name: department.nome,
      description: department.descricao,
      active: true,
      ...match,
    }
    const target = await tx.inventoryDepartment.upsert({
      where: {
        portalId_legacySource_legacyId: { portalId, legacySource: source, legacyId: department.id },
      },
      create: {
        portalId,
        legacySource: source,
        legacyId: department.id,
        ...data,
        ...(dateOrUndefined(department.created_at)
          ? { createdAt: dateOrUndefined(department.created_at) }
          : {}),
      },
      update: data,
      select: { id: true },
    })
    maps.departments.set(department.id, target.id)
  }

  for (const location of document.locais) {
    const data = { name: location.nome, description: location.descricao, active: true }
    const target = await tx.inventoryLocation.upsert({
      where: {
        portalId_legacySource_legacyId: { portalId, legacySource: source, legacyId: location.id },
      },
      create: {
        portalId,
        legacySource: source,
        legacyId: location.id,
        ...data,
        ...(dateOrUndefined(location.created_at)
          ? { createdAt: dateOrUndefined(location.created_at) }
          : {}),
      },
      update: data,
      select: { id: true },
    })
    maps.locations.set(location.id, target.id)
  }

  const existingPeople = await tx.inventoryPerson.findMany({
    where: {
      portalId,
      legacySource: source,
      legacyId: { in: document.colaboradores.map((item) => item.id) },
    },
    select: {
      legacyId: true,
      bitrixUserId: true,
      bitrixMatchStatus: true,
      bitrixMatchMethod: true,
    },
  })
  const existingPersonByLegacyId = new Map(existingPeople.map((item) => [item.legacyId!, item]))
  for (const person of document.colaboradores) {
    const match = personMatchData(
      reconciliation.people.get(person.id)!,
      existingPersonByLegacyId.get(person.id),
    )
    const data = {
      name: person.nome,
      departmentId:
        person.department_id === null ? null : maps.departments.get(person.department_id)!,
      title: person.cargo,
      email: person.email,
      employeeNumber: person.matricula,
      employmentType:
        person.tipo_vinculo === null ? null : LEGACY_ENUM_MAPS.employmentType[person.tipo_vinculo],
      status: LEGACY_ENUM_MAPS.personStatus[person.status],
      notes: person.observacoes,
      archivedAt: null,
      ...match,
    }
    const target = await tx.inventoryPerson.upsert({
      where: {
        portalId_legacySource_legacyId: { portalId, legacySource: source, legacyId: person.id },
      },
      create: {
        portalId,
        legacySource: source,
        legacyId: person.id,
        ...data,
        ...(dateOrUndefined(person.created_at)
          ? { createdAt: dateOrUndefined(person.created_at) }
          : {}),
      },
      update: { ...data, revision: { increment: 1 } },
      select: { id: true },
    })
    maps.people.set(person.id, target.id)
  }

  for (const equipment of document.equipamentos) {
    const data = {
      patrimony: equipment.patrimonio,
      assetTag: equipment.tag_patrimonio,
      name: equipment.nome,
      categoryId: maps.categories.get(equipment.category_id)!,
      status: LEGACY_ENUM_MAPS.equipmentStatus[equipment.status],
      currentHolderId:
        equipment.current_holder_id === null ? null : maps.people.get(equipment.current_holder_id)!,
      departmentId:
        equipment.department_id === null ? null : maps.departments.get(equipment.department_id)!,
      locationId:
        equipment.location_id === null ? null : maps.locations.get(equipment.location_id)!,
      locationDetail: equipment.localizacao,
      serialNumber: equipment.numero_serie,
      invoiceNumber: equipment.nota_fiscal,
      acquiredAt: parseLegacyDate(equipment.data_aquisicao),
      receivedAt: parseLegacyDate(equipment.data_recebimento),
      deliveredAt: parseLegacyDate(equipment.data_entrega),
      warrantyEndsAt: parseLegacyDate(equipment.data_garantia),
      specs: jsonInput(equipment.specs),
      legacyInvalidSpecs: jsonInput(prepared.quarantine.equipment.get(equipment.id) ?? {}),
      notes: equipment.observacoes,
      archivedAt: null,
    }
    const target = await tx.inventoryEquipment.upsert({
      where: {
        portalId_legacySource_legacyId: { portalId, legacySource: source, legacyId: equipment.id },
      },
      create: {
        portalId,
        legacySource: source,
        legacyId: equipment.id,
        ...data,
        ...(dateOrUndefined(equipment.created_at)
          ? { createdAt: dateOrUndefined(equipment.created_at) }
          : {}),
        ...(dateOrUndefined(equipment.updated_at)
          ? { updatedAt: dateOrUndefined(equipment.updated_at) }
          : {}),
      },
      update: {
        ...data,
        revision: { increment: 1 },
        ...(dateOrUndefined(equipment.updated_at)
          ? { updatedAt: dateOrUndefined(equipment.updated_at) }
          : {}),
      },
      select: { id: true },
    })
    maps.equipment.set(equipment.id, target.id)
  }

  const departmentNames = new Map(document.setores.map((item) => [item.id, item.nome]))
  for (const movement of document.historico_transferencias) {
    const data = {
      equipmentId: maps.equipment.get(movement.equipment_id)!,
      fromPersonId:
        movement.from_person_id === null ? null : maps.people.get(movement.from_person_id)!,
      toPersonId: movement.to_person_id === null ? null : maps.people.get(movement.to_person_id)!,
      fromPersonName: movement.from_nome,
      toPersonName: movement.to_nome,
      fromDepartmentId:
        movement.from_department_id === null
          ? null
          : maps.departments.get(movement.from_department_id)!,
      toDepartmentId:
        movement.to_department_id === null
          ? null
          : maps.departments.get(movement.to_department_id)!,
      fromDepartmentName:
        movement.from_department_id === null
          ? null
          : (departmentNames.get(movement.from_department_id) ?? null),
      toDepartmentName:
        movement.to_department_id === null
          ? null
          : (departmentNames.get(movement.to_department_id) ?? null),
      movedAt: parseLegacyDate(movement.data_mudanca)!,
      reason: movement.motivo,
      origin: LEGACY_ENUM_MAPS.movementOrigin[movement.origem],
      performedByBitrixUserId: null,
      performedByName: movement.performed_by_nome,
      ...(dateOrUndefined(movement.created_at)
        ? { createdAt: dateOrUndefined(movement.created_at) }
        : {}),
    }
    await tx.inventoryMovement.upsert({
      where: {
        portalId_legacySource_legacyId: { portalId, legacySource: source, legacyId: movement.id },
      },
      create: { portalId, legacySource: source, legacyId: movement.id, ...data },
      // Eventos importados são append-only. Um novo snapshot pode acrescentar
      // movimentos, mas nunca reescreve um evento previamente confirmado.
      update: {},
    })
  }

  for (const extension of document.ramais) {
    const data = {
      number: extension.numero,
      collaborator: extension.colaborador,
      department: extension.setor,
      type: extension.tipo,
      active: extension.ativo,
      notes: extension.observacoes,
      archivedAt: null,
    }
    await tx.inventoryExtension.upsert({
      where: {
        portalId_legacySource_legacyId: { portalId, legacySource: source, legacyId: extension.id },
      },
      create: {
        portalId,
        legacySource: source,
        legacyId: extension.id,
        ...data,
        ...(dateOrUndefined(extension.created_at)
          ? { createdAt: dateOrUndefined(extension.created_at) }
          : {}),
      },
      update: data,
    })
  }

  for (const receiving of document.recebimentos) {
    const data = {
      receivedAt: parseLegacyDate(receiving.data_recebimento),
      equipment: receiving.equipamento,
      quantity: receiving.quantidade,
      tag: receiving.tag,
      deliveredAt: parseLegacyDate(receiving.data_entrega),
      deliveredTo: receiving.entregue_para,
      notes: receiving.observacoes,
      archivedAt: null,
    }
    await tx.inventoryReceiving.upsert({
      where: {
        portalId_legacySource_legacyId: { portalId, legacySource: source, legacyId: receiving.id },
      },
      create: {
        portalId,
        legacySource: source,
        legacyId: receiving.id,
        ...data,
        ...(dateOrUndefined(receiving.created_at)
          ? { createdAt: dateOrUndefined(receiving.created_at) }
          : {}),
      },
      update: data,
    })
  }

  for (const customModule of document.abas_personalizadas) {
    const data = {
      name: customModule.nome,
      icon: customModule.icone ?? 'clipboard',
      description: customModule.descricao,
      titleLabel: customModule.titulo_label ?? 'Nome',
      sortOrder: customModule.ordem ?? 100,
      active: customModule.ativo,
    }
    const target = await tx.inventoryCustomModule.upsert({
      where: {
        portalId_legacySource_legacyId: {
          portalId,
          legacySource: source,
          legacyId: customModule.id,
        },
      },
      create: {
        portalId,
        legacySource: source,
        legacyId: customModule.id,
        ...data,
        ...(dateOrUndefined(customModule.created_at)
          ? { createdAt: dateOrUndefined(customModule.created_at) }
          : {}),
      },
      update: { ...data, revision: { increment: 1 } },
      select: { id: true },
    })
    maps.modules.set(customModule.id, target.id)
    for (const field of customModule.campos) {
      const fieldData = {
        moduleId: target.id,
        key: field.chave,
        label: field.rotulo,
        type: LEGACY_ENUM_MAPS.fieldType[field.tipo],
        options: parseOptions(field.opcoes),
        sortOrder: field.ordem ?? 100,
        required: field.obrigatorio,
        listVisible: field.mostrar_na_lista,
        expiryAlert: field.alerta_vencimento,
        active: true,
      }
      await tx.inventoryCustomModuleField.upsert({
        where: {
          portalId_legacySource_legacyId: { portalId, legacySource: source, legacyId: field.id },
        },
        create: { portalId, legacySource: source, legacyId: field.id, ...fieldData },
        update: fieldData,
      })
    }
    for (const record of customModule.registros) {
      const recordData = {
        moduleId: target.id,
        title: record.titulo,
        data: jsonInput(record.dados),
        archivedAt: null,
        ...(dateOrUndefined(record.updated_at)
          ? { updatedAt: dateOrUndefined(record.updated_at) }
          : {}),
      }
      const targetRecord = await tx.inventoryCustomRecord.upsert({
        where: {
          portalId_legacySource_legacyId: { portalId, legacySource: source, legacyId: record.id },
        },
        create: {
          portalId,
          legacySource: source,
          legacyId: record.id,
          ...recordData,
          ...(dateOrUndefined(record.created_at)
            ? { createdAt: dateOrUndefined(record.created_at) }
            : {}),
        },
        update: { ...recordData, revision: { increment: 1 } },
        select: { id: true },
      })
      maps.records.set(record.id, targetRecord.id)
    }
  }

  const peopleById = new Map(document.colaboradores.map((item) => [item.id, item]))
  for (const term of document.termos) {
    const originPerson = term.person_id === null ? undefined : peopleById.get(term.person_id)
    const destinationPerson =
      term.destino_person_id === null ? undefined : peopleById.get(term.destino_person_id)
    const data = {
      type: LEGACY_ENUM_MAPS.termType[term.tipo],
      personId: term.person_id === null ? null : maps.people.get(term.person_id)!,
      personName: term.person_nome,
      personDepartmentName:
        originPerson?.department_id === null || originPerson?.department_id === undefined
          ? null
          : (departmentNames.get(originPerson.department_id) ?? null),
      destinationPersonId:
        term.destino_person_id === null ? null : maps.people.get(term.destino_person_id)!,
      destinationPersonName: term.destino_nome,
      destinationDepartmentName:
        destinationPerson?.department_id === null || destinationPerson?.department_id === undefined
          ? null
          : (departmentNames.get(destinationPerson.department_id) ?? null),
      items: jsonInput(term.itens),
      observations: term.observacoes,
      createdByBitrixUserId: null,
      createdByName: term.created_by_nome,
      archivedAt: null,
      ...(dateOrUndefined(term.created_at) ? { createdAt: dateOrUndefined(term.created_at) } : {}),
    }
    const target = await tx.inventoryTerm.upsert({
      where: {
        portalId_legacySource_legacyId: { portalId, legacySource: source, legacyId: term.id },
      },
      create: { portalId, legacySource: source, legacyId: term.id, ...data },
      // Termos são documentos legais imutáveis depois da primeira carga.
      update: {},
      select: { id: true },
    })
    maps.terms.set(term.id, target.id)
  }

  const entityMaps: Record<string, Map<number, string>> = {
    equipment: maps.equipment,
    person: maps.people,
    department: maps.departments,
    category: maps.categories,
    module: maps.modules,
    record: maps.records,
    termo: maps.terms,
  }
  const fallbackCreatedAt = parseLegacyDateTime(document._meta.exportado_em) ?? new Date()
  for (const audit of document.auditoria) {
    const targetEntityId =
      audit.entity_type && audit.entity_id !== null
        ? (entityMaps[audit.entity_type]?.get(audit.entity_id) ??
          `legacy:${audit.entity_type}:${audit.entity_id}`)
        : `legacy:audit:${audit.id}`
    const metadata = {
      legacySource: source,
      legacyAuditId: audit.id,
      legacyEntityType: audit.entity_type,
      legacyEntityId: audit.entity_id,
      entityLabel: audit.entity_label,
      field: audit.campo,
      previousValue: audit.valor_antigo,
      newValue: audit.valor_novo,
      description: audit.descricao,
      performedByLegacyUserId: audit.performed_by_id ?? null,
      performedByName: audit.performed_by_nome,
    }
    await tx.auditLog.upsert({
      where: { id: deterministicAuditId(portalId, audit.id) },
      create: {
        id: deterministicAuditId(portalId, audit.id),
        portalId,
        bitrixUserId:
          audit.performed_by_id === undefined || audit.performed_by_id === null
            ? 'legacy-inventory:unknown'
            : `legacy-inventory:user:${audit.performed_by_id}`,
        action: normalizeAction(audit.acao),
        entityType: `InventoryLegacy:${audit.entity_type ?? 'unknown'}`,
        entityId: targetEntityId,
        metadata: jsonInput(metadata),
        createdAt: parseLegacyDateTime(audit.created_at) ?? fallbackCreatedAt,
      },
      // Auditoria também é append-only; novos cortes apenas acrescentam IDs.
      update: {},
    })
  }
  await archiveLegacyRowsMissingFromSnapshot(tx, portalId, document)
  return maps
}

async function verifyImportedCounts(
  tx: Prisma.TransactionClient,
  portalId: string,
  document: InventoryExportDocument,
): Promise<Record<string, number>> {
  const source = INVENTORY_LEGACY_SOURCE
  const whereIds = (ids: number[]) => ({ portalId, legacySource: source, legacyId: { in: ids } })
  const auditIds = document.auditoria.map((item) => deterministicAuditId(portalId, item.id))
  const values = await Promise.all([
    tx.inventoryCategory.count({ where: whereIds(document.categorias.map((item) => item.id)) }),
    tx.inventoryField.count({
      where: whereIds(document.categorias.flatMap((item) => item.campos.map((field) => field.id))),
    }),
    tx.inventoryDepartment.count({ where: whereIds(document.setores.map((item) => item.id)) }),
    tx.inventoryLocation.count({ where: whereIds(document.locais.map((item) => item.id)) }),
    tx.inventoryPerson.count({ where: whereIds(document.colaboradores.map((item) => item.id)) }),
    tx.inventoryEquipment.count({ where: whereIds(document.equipamentos.map((item) => item.id)) }),
    tx.inventoryMovement.count({
      where: whereIds(document.historico_transferencias.map((item) => item.id)),
    }),
    tx.inventoryExtension.count({ where: whereIds(document.ramais.map((item) => item.id)) }),
    tx.inventoryReceiving.count({ where: whereIds(document.recebimentos.map((item) => item.id)) }),
    tx.inventoryCustomModule.count({
      where: whereIds(document.abas_personalizadas.map((item) => item.id)),
    }),
    tx.inventoryCustomModuleField.count({
      where: whereIds(
        document.abas_personalizadas.flatMap((item) => item.campos.map((field) => field.id)),
      ),
    }),
    tx.inventoryCustomRecord.count({
      where: whereIds(
        document.abas_personalizadas.flatMap((item) => item.registros.map((record) => record.id)),
      ),
    }),
    tx.inventoryTerm.count({ where: whereIds(document.termos.map((item) => item.id)) }),
    tx.auditLog.count({ where: { portalId, id: { in: auditIds } } }),
  ])
  const keys = [
    'categories',
    'custom_fields',
    'departments',
    'locations',
    'people',
    'equipment',
    'assignment_history',
    'extensions',
    'receiving',
    'custom_modules',
    'custom_module_fields',
    'custom_records',
    'termos',
    'audit_log',
  ] as const
  const expected: Record<(typeof keys)[number], number> = {
    categories: document.categorias.length,
    custom_fields: document.categorias.reduce((sum, item) => sum + item.campos.length, 0),
    departments: document.setores.length,
    locations: document.locais.length,
    people: document.colaboradores.length,
    equipment: document.equipamentos.length,
    assignment_history: document.historico_transferencias.length,
    extensions: document.ramais.length,
    receiving: document.recebimentos.length,
    custom_modules: document.abas_personalizadas.length,
    custom_module_fields: document.abas_personalizadas.reduce(
      (sum, item) => sum + item.campos.length,
      0,
    ),
    custom_records: document.abas_personalizadas.reduce(
      (sum, item) => sum + item.registros.length,
      0,
    ),
    termos: document.termos.length,
    audit_log: document.auditoria.length,
  }
  const verification: Record<string, number> = {}
  const errors: string[] = []
  keys.forEach((key, index) => {
    verification[key] = values[index]!
    if (values[index] !== expected[key])
      errors.push(`${key}: esperado ${expected[key]}, persistido ${values[index]}.`)
  })
  if (errors.length > 0) throw new Error(`Verificação pós-importação falhou: ${errors.join(' ')}`)
  return verification
}

async function recordFailedRun(options: RunInventoryImportOptions, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  const unique = {
    portalId_source_rawSha256: {
      portalId: options.portalId,
      source: INVENTORY_LEGACY_SOURCE,
      rawSha256: options.prepared.rawSha256,
    },
  }
  const existing = await options.prisma.inventoryImportRun.findUnique({
    where: unique,
    select: { status: true },
  })
  if (existing?.status === 'SUCCESS') return
  await options.prisma.inventoryImportRun.upsert({
    where: unique,
    create: {
      portalId: options.portalId,
      source: INVENTORY_LEGACY_SOURCE,
      formatVersion: options.prepared.document._meta.versao,
      rawSha256: options.prepared.rawSha256,
      canonicalSha256: options.prepared.canonicalSha256,
      status: 'FAILED',
      expectedCounts: jsonInput(options.prepared.counts),
      report: jsonInput({ phase: 'apply', rolledBack: true }),
      errorMessage: message.slice(0, 500),
      executedBy: options.executedBy,
      finishedAt: new Date(),
    },
    update: {
      status: 'FAILED',
      canonicalSha256: options.prepared.canonicalSha256,
      expectedCounts: jsonInput(options.prepared.counts),
      report: jsonInput({ phase: 'apply', rolledBack: true }),
      errorMessage: message.slice(0, 500),
      executedBy: options.executedBy,
      finishedAt: new Date(),
    },
  })
}

export async function runInventoryImport(
  options: RunInventoryImportOptions,
): Promise<InventoryImportExecutionReport> {
  const inspection = await inspectImport(options)
  if (options.mode === 'dry-run' || inspection.skipRunId) return inspection.report

  try {
    const result = await options.prisma.$transaction(
      async (tx) => {
        // Serializa qualquer corte do mesmo portal/fonte, inclusive snapshots
        // com hashes diferentes. A trava é liberada automaticamente no commit.
        await tx.$queryRaw<Array<{ lock: string | null }>>(Prisma.sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${options.portalId}:${INVENTORY_LEGACY_SOURCE}`}, 0)
          )::text AS "lock"
        `)
        const successfulRuns = await tx.inventoryImportRun.findMany({
          where: { portalId: options.portalId, source: INVENTORY_LEGACY_SOURCE, status: 'SUCCESS' },
          select: { id: true, rawSha256: true, canonicalSha256: true },
        })
        const identical = successfulRuns.find(
          (run) =>
            run.rawSha256 === options.prepared.rawSha256 ||
            run.canonicalSha256 === options.prepared.canonicalSha256,
        )
        if (identical) return { skippedRunId: identical.id } as const
        if (successfulRuns.length > 0 && !options.allowNewSnapshot) {
          throw new InventoryImportSnapshotConflictError(
            'Outro snapshot foi concluído durante esta execução.',
          )
        }

        const run = await tx.inventoryImportRun.upsert({
          where: {
            portalId_source_rawSha256: {
              portalId: options.portalId,
              source: INVENTORY_LEGACY_SOURCE,
              rawSha256: options.prepared.rawSha256,
            },
          },
          create: {
            portalId: options.portalId,
            source: INVENTORY_LEGACY_SOURCE,
            formatVersion: options.prepared.document._meta.versao,
            rawSha256: options.prepared.rawSha256,
            canonicalSha256: options.prepared.canonicalSha256,
            status: 'RUNNING',
            expectedCounts: jsonInput(options.prepared.counts),
            report: jsonInput({ phase: 'importing' }),
            executedBy: options.executedBy,
          },
          update: {
            canonicalSha256: options.prepared.canonicalSha256,
            status: 'RUNNING',
            expectedCounts: jsonInput(options.prepared.counts),
            report: jsonInput({ phase: 'importing' }),
            errorMessage: null,
            executedBy: options.executedBy,
            startedAt: new Date(),
            finishedAt: null,
          },
          select: { id: true },
        })

        await importDocument(tx, options.portalId, options.prepared, inspection.reconciliation)
        const verification = await verifyImportedCounts(
          tx,
          options.portalId,
          options.prepared.document,
        )
        const finalReport = {
          ...inspection.report,
          status: 'imported' as const,
          verification,
          importRunId: run.id,
        }
        await tx.inventoryImportRun.update({
          where: { id: run.id },
          data: {
            status: 'SUCCESS',
            report: jsonInput(finalReport),
            errorMessage: null,
            finishedAt: new Date(),
          },
        })
        return { finalReport } as const
      },
      { maxWait: 20_000, timeout: 300_000 },
    )
    if ('skippedRunId' in result) {
      return { ...inspection.report, status: 'skipped', existingRunId: result.skippedRunId }
    }
    return result.finalReport
  } catch (error) {
    try {
      const concurrentSuccess = await options.prisma.inventoryImportRun.findFirst({
        where: {
          portalId: options.portalId,
          source: INVENTORY_LEGACY_SOURCE,
          status: 'SUCCESS',
          OR: [
            { rawSha256: options.prepared.rawSha256 },
            { canonicalSha256: options.prepared.canonicalSha256 },
          ],
        },
        select: { id: true },
      })
      if (concurrentSuccess) {
        return { ...inspection.report, status: 'skipped', existingRunId: concurrentSuccess.id }
      }
    } catch {
      // Se a consulta de reconciliação falhar, preservamos o erro original.
    }
    try {
      await recordFailedRun(options, error)
    } catch {
      // A falha de telemetria não pode esconder o erro original. Todas as
      // mutações de domínio já foram revertidas pela transação atômica.
    }
    throw error
  }
}

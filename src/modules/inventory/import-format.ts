import { createHash } from 'crypto'
import { z } from 'zod'
import { inventoryDateOnlyToday } from './date'

export const INVENTORY_LEGACY_SOURCE = 'inventory-flask-sqlite'

type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

const MAX_ROWS = 100_000
const legacyId = z.number().int().positive()
const text = (max = 100_000) => z.string().max(max)
const nullableText = (max = 100_000) => text(max).nullable()
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
)
const jsonObjectSchema: z.ZodType<JsonObject> = z.record(jsonValueSchema)

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'Data inválida.')

const nullableDateOnly = dateOnlySchema.nullable()
const dateTimeSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => parseLegacyDateTime(value) !== null, 'Data/hora inválida.')
const nullableDateTime = dateTimeSchema.nullable()
const optionalCreatedAt = nullableDateTime.optional()

const legacyFieldTypeSchema = z.enum([
  'texto',
  'area',
  'numero',
  'data',
  'selecao',
  'booleano',
  'senha',
  'mac',
  'ip',
])
const equipmentStatusSchema = z.enum([
  'ativo',
  'estoque',
  'manutencao',
  'quebrado',
  'emprestado',
  'inativo',
])
const personStatusSchema = z.enum(['ativo', 'afastado', 'desligado'])
const employmentTypeSchema = z.enum(['clt', 'pj', 'estagio', 'temporario', 'outro'])
const movementOriginSchema = z.enum(['manual', 'importacao'])
const termTypeSchema = z.enum(['entrega', 'responsabilidade', 'devolucao', 'transferencia'])
const attachmentEntityTypeSchema = z.enum(['equipment', 'person', 'termo', 'custom_record'])

const fieldSchema = z
  .object({
    id: legacyId,
    chave: text(60).min(1),
    rotulo: text(120).min(1),
    tipo: legacyFieldTypeSchema,
    opcoes: nullableText(),
    ordem: z.number().int().nullable(),
    obrigatorio: z.boolean(),
    mostrar_na_lista: z.boolean(),
  })
  .strict()

const categorySchema = z
  .object({
    id: legacyId,
    nome: text(80).min(1),
    prefixo: nullableText(10),
    icone: nullableText(40),
    descricao: nullableText(255),
    ordem: z.number().int().nullable(),
    campos: z.array(fieldSchema).max(MAX_ROWS),
  })
  .strict()

const departmentSchema = z
  .object({
    id: legacyId,
    nome: text(120).min(1),
    descricao: nullableText(255),
    created_at: optionalCreatedAt,
  })
  .strict()

const locationSchema = z
  .object({
    id: legacyId,
    nome: text(120).min(1),
    descricao: nullableText(255),
    created_at: optionalCreatedAt,
  })
  .strict()

const personSchema = z
  .object({
    id: legacyId,
    nome: text(160).min(1),
    department_id: legacyId.nullable(),
    cargo: nullableText(120),
    email: nullableText(320),
    matricula: nullableText(60),
    tipo_vinculo: employmentTypeSchema.nullable(),
    status: personStatusSchema,
    observacoes: nullableText(),
    created_at: optionalCreatedAt,
  })
  .strict()

const equipmentSchema = z
  .object({
    id: legacyId,
    patrimonio: nullableText(60),
    tag_patrimonio: nullableText(60),
    nome: nullableText(160),
    category_id: legacyId,
    status: equipmentStatusSchema,
    current_holder_id: legacyId.nullable(),
    department_id: legacyId.nullable(),
    location_id: legacyId.nullable(),
    localizacao: nullableText(160),
    numero_serie: nullableText(120),
    nota_fiscal: nullableText(60),
    data_aquisicao: nullableDateOnly,
    data_recebimento: nullableDateOnly,
    data_entrega: nullableDateOnly,
    data_garantia: nullableDateOnly,
    observacoes: nullableText(),
    created_at: nullableDateTime,
    updated_at: nullableDateTime,
    categoria_nome: nullableText(80),
    specs: jsonObjectSchema,
  })
  .strict()

const movementSchema = z
  .object({
    id: legacyId,
    equipment_id: legacyId,
    from_person_id: legacyId.nullable(),
    to_person_id: legacyId.nullable(),
    from_nome: nullableText(200),
    to_nome: nullableText(200),
    from_department_id: legacyId.nullable(),
    to_department_id: legacyId.nullable(),
    data_mudanca: dateOnlySchema,
    motivo: nullableText(),
    origem: movementOriginSchema,
    performed_by_id: legacyId.nullable().optional(),
    performed_by_nome: nullableText(120),
    created_at: nullableDateTime,
  })
  .strict()

const extensionSchema = z
  .object({
    id: legacyId,
    numero: nullableText(20),
    colaborador: nullableText(160),
    setor: nullableText(120),
    tipo: nullableText(60),
    ativo: z.boolean(),
    observacoes: nullableText(),
    created_at: optionalCreatedAt,
  })
  .strict()

const receivingSchema = z
  .object({
    id: legacyId,
    data_recebimento: nullableDateOnly,
    equipamento: nullableText(200),
    quantidade: z.number().int().positive(),
    tag: nullableText(60),
    data_entrega: nullableDateOnly,
    entregue_para: nullableText(200),
    observacoes: nullableText(),
    created_at: optionalCreatedAt,
  })
  .strict()

const customModuleFieldSchema = fieldSchema.extend({ alerta_vencimento: z.boolean() }).strict()

const customRecordSchema = z
  .object({
    id: legacyId,
    titulo: nullableText(200),
    created_at: nullableDateTime,
    updated_at: nullableDateTime.optional(),
    dados: jsonObjectSchema,
  })
  .strict()

const customModuleSchema = z
  .object({
    id: legacyId,
    nome: text(80).min(1),
    icone: nullableText(40),
    descricao: nullableText(255),
    titulo_label: nullableText(60),
    ordem: z.number().int().nullable(),
    ativo: z.boolean(),
    created_at: optionalCreatedAt,
    campos: z.array(customModuleFieldSchema).max(MAX_ROWS),
    registros: z.array(customRecordSchema).max(MAX_ROWS),
  })
  .strict()

const termSchema = z
  .object({
    id: legacyId,
    tipo: termTypeSchema,
    person_id: legacyId.nullable(),
    person_nome: nullableText(200),
    destino_person_id: legacyId.nullable(),
    destino_nome: nullableText(200),
    observacoes: nullableText(),
    created_by_nome: nullableText(120),
    created_at: nullableDateTime,
    itens: z.array(jsonObjectSchema).max(MAX_ROWS),
  })
  .strict()

const attachmentSchema = z
  .object({
    id: legacyId,
    entity_type: attachmentEntityTypeSchema,
    entity_id: legacyId,
    stored_name: nullableText(200),
    nome_original: nullableText(255),
    content_type: nullableText(120),
    tamanho: z.number().int().nonnegative().nullable(),
    descricao: nullableText(255),
    uploaded_by_nome: nullableText(120),
    created_at: nullableDateTime,
  })
  .strict()

const systemUserSchema = z
  .object({
    id: legacyId,
    username: text(80).min(1),
    nome: nullableText(120),
    email: nullableText(320),
    papel: z.enum(['admin', 'operador', 'leitura']),
    ativo: z.boolean(),
    ultimo_acesso: nullableDateTime.optional(),
    created_at: optionalCreatedAt,
  })
  .strict()

const auditSchema = z
  .object({
    id: legacyId,
    entity_type: nullableText(40),
    entity_id: legacyId.nullable(),
    entity_label: nullableText(200),
    acao: nullableText(30),
    campo: nullableText(80),
    valor_antigo: nullableText(),
    valor_novo: nullableText(),
    descricao: nullableText(),
    performed_by_id: legacyId.nullable().optional(),
    performed_by_nome: nullableText(120),
    created_at: nullableDateTime,
  })
  .strict()

const sectionsShape = {
  categorias: z.array(categorySchema).max(MAX_ROWS),
  setores: z.array(departmentSchema).max(MAX_ROWS),
  locais: z.array(locationSchema).max(MAX_ROWS),
  colaboradores: z.array(personSchema).max(MAX_ROWS),
  equipamentos: z.array(equipmentSchema).max(MAX_ROWS),
  historico_transferencias: z.array(movementSchema).max(MAX_ROWS),
  ramais: z.array(extensionSchema).max(MAX_ROWS),
  recebimentos: z.array(receivingSchema).max(MAX_ROWS),
  abas_personalizadas: z.array(customModuleSchema).max(MAX_ROWS),
  termos: z.array(termSchema).max(MAX_ROWS),
  anexos: z.array(attachmentSchema).max(MAX_ROWS),
  usuarios_sistema: z.array(systemUserSchema).max(MAX_ROWS),
  auditoria: z.array(auditSchema).max(MAX_ROWS),
}

export const INVENTORY_COUNT_KEYS = [
  'users',
  'departments',
  'people',
  'locations',
  'categories',
  'custom_fields',
  'equipment',
  'assignment_history',
  'extensions',
  'receiving',
  'custom_modules',
  'custom_module_fields',
  'custom_records',
  'attachments',
  'termos',
  'audit_log',
] as const

export type InventoryCountKey = (typeof INVENTORY_COUNT_KEYS)[number]
export type InventoryCounts = Record<InventoryCountKey, number>

const manifestCountsSchema = z
  .object(
    Object.fromEntries(
      INVENTORY_COUNT_KEYS.map((key) => [key, z.number().int().nonnegative()]),
    ) as Record<InventoryCountKey, z.ZodNumber>,
  )
  .strict()

const metaV1Schema = z
  .object({
    exportado_em: dateTimeSchema,
    origem: text(200).min(1),
    versao: z.literal(1),
  })
  .strict()

const metaV2Schema = z
  .object({
    exportado_em: dateTimeSchema.refine(
      (value) => value.endsWith('Z'),
      'A exportação v2 deve usar UTC com sufixo Z.',
    ),
    origem: text(200).min(1),
    versao: z.literal(2),
    modo_leitura: text(500).min(1),
    integridade: z
      .object({
        sqlite_integrity_check: z.literal('ok'),
        violacoes_chave_estrangeira: z.literal(0),
        contagens_validadas: z.literal(true),
      })
      .strict(),
    manifesto_contagens: manifestCountsSchema,
    segredos_removidos: z
      .object({
        aviso: text(2_000).min(1),
        politica: text(2_000).min(1),
        users_password_hash_omitidos: z.number().int().nonnegative(),
        campos_senha_declarados: z.number().int().nonnegative(),
        opcoes_omitidas_campos_senha: z.number().int().nonnegative(),
        valores_omitidos_equipamentos: z.number().int().nonnegative(),
        valores_omitidos_modulos: z.number().int().nonnegative(),
        trechos_omitidos_termos: z.number().int().nonnegative(),
        valores_omitidos_auditoria: z.number().int().nonnegative(),
      })
      .strict(),
    fingerprint: z
      .object({
        algoritmo: z.literal('SHA-256'),
        escopo: z.literal('conteudo_exportado_redigido_sem_meta'),
        canonizacao: z.literal('typed-utf8-ieee754-v1').optional(),
        valor: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
  })
  .strict()

const documentV1Schema = z.object({ _meta: metaV1Schema, ...sectionsShape }).strict()
const documentV2Schema = z.object({ _meta: metaV2Schema, ...sectionsShape }).strict()

export type InventoryExportDocument =
  z.infer<typeof documentV1Schema> | z.infer<typeof documentV2Schema>

export interface ImportSanitizationReport {
  passwordFieldOptionsRemoved: number
  equipmentPasswordValuesRemoved: number
  customRecordPasswordValuesRemoved: number
  termPasswordValuesRemoved: number
  auditPasswordValuesRemoved: number
}

export interface PreparedInventoryExport {
  document: InventoryExportDocument
  rawSha256: string
  canonicalSha256: string
  counts: InventoryCounts
  sanitization: ImportSanitizationReport
  normalization: ImportNormalizationReport
  quarantine: { equipment: Map<number, JsonObject> }
  warnings: string[]
}

export interface ImportNormalizationReport {
  numberValuesNormalized: number
  booleanValuesNormalized: number
  dateValuesNormalized: number
  legacyValuesQuarantined: number
  equipmentWithQuarantinedValues: number
}

export class InventoryImportValidationError extends Error {
  constructor(
    message: string,
    public readonly details: string[] = [],
  ) {
    super(message)
    this.name = 'InventoryImportValidationError'
  }
}

export function parseLegacyDateTime(value: string | null | undefined): Date | null {
  if (!value) return null
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  const normalized = value.includes(' ') ? value.replace(' ', 'T') : value
  const parsed = new Date(hasZone ? normalized : `${normalized}Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function parseLegacyDate(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null
}

export function stableJsonStringify(value: JsonValue | Record<string, unknown>): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key] as JsonValue)}`)
    .join(',')}}`
}

function uint32Bytes(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

/** Codificação binária tipada espelhada pelo exportador Python. */
export function canonicalFingerprintBytes(value: JsonValue | Record<string, unknown>): Uint8Array {
  const chunks: Uint8Array[] = []
  const encoder = new TextEncoder()
  const append = (input: JsonValue | Record<string, unknown>): void => {
    if (input === null) {
      chunks.push(encoder.encode('N'))
      return
    }
    if (typeof input === 'boolean') {
      chunks.push(encoder.encode(input ? 'T' : 'F'))
      return
    }
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new TypeError('Fingerprint não aceita número não finito.')
      const bytes = new Uint8Array(9)
      bytes[0] = 'D'.charCodeAt(0)
      new DataView(bytes.buffer).setFloat64(1, Object.is(input, -0) ? 0 : input, false)
      chunks.push(bytes)
      return
    }
    if (typeof input === 'string') {
      const bytes = encoder.encode(input)
      chunks.push(encoder.encode('S'), uint32Bytes(bytes.length), bytes)
      return
    }
    if (Array.isArray(input)) {
      chunks.push(encoder.encode('A'), uint32Bytes(input.length))
      input.forEach((item) => append(item))
      return
    }
    const entries = Object.entries(input).sort(([left], [right]) =>
      Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')),
    )
    chunks.push(encoder.encode('O'), uint32Bytes(entries.length))
    for (const [key, item] of entries) {
      append(key)
      append(item as JsonValue)
    }
  }
  append(value)
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function computeInventoryCounts(document: InventoryExportDocument): InventoryCounts {
  return {
    users: document.usuarios_sistema.length,
    departments: document.setores.length,
    people: document.colaboradores.length,
    locations: document.locais.length,
    categories: document.categorias.length,
    custom_fields: document.categorias.reduce(
      (total, category) => total + category.campos.length,
      0,
    ),
    equipment: document.equipamentos.length,
    assignment_history: document.historico_transferencias.length,
    extensions: document.ramais.length,
    receiving: document.recebimentos.length,
    custom_modules: document.abas_personalizadas.length,
    custom_module_fields: document.abas_personalizadas.reduce(
      (total, customModule) => total + customModule.campos.length,
      0,
    ),
    custom_records: document.abas_personalizadas.reduce(
      (total, customModule) => total + customModule.registros.length,
      0,
    ),
    attachments: document.anexos.length,
    termos: document.termos.length,
    audit_log: document.auditoria.length,
  }
}

function duplicateGroupCount(values: Array<string | null>): number {
  const counts = new Map<string, number>()
  for (const value of values) {
    const normalized = value?.trim().toLocaleLowerCase('pt-BR')
    if (!normalized) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  return [...counts.values()].filter((count) => count > 1).length
}

/**
 * Anomalias conhecidas não invalidam o corte: os valores precisam ser
 * preservados para revisão humana e o estado atual continua canônico. O
 * dry-run, porém, deve torná-las explícitas antes do --apply.
 */
function dataQualityWarnings(document: InventoryExportDocument): string[] {
  const warnings: string[] = []
  const today = inventoryDateOnlyToday()
  const suspiciousMovementDates = document.historico_transferencias.filter(
    (movement) => Number(movement.data_mudanca.slice(0, 4)) < 2000 || movement.data_mudanca > today,
  )
  if (suspiciousMovementDates.length > 0) {
    warnings.push(
      `${suspiciousMovementDates.length} movimentação(ões) possui(em) data anterior a 2000 ou futura e exige(m) revisão (legacy IDs: ${suspiciousMovementDates.map((item) => item.id).join(', ')}).`,
    )
  }

  const duplicateAssetTags = duplicateGroupCount(
    document.equipamentos.map((equipment) => equipment.tag_patrimonio),
  )
  if (duplicateAssetTags > 0) {
    warnings.push(
      `${duplicateAssetTags} grupo(s) de número patrimonial duplicado será(ão) preservado(s).`,
    )
  }
  const duplicateSerials = duplicateGroupCount(
    document.equipamentos.map((equipment) => equipment.numero_serie),
  )
  if (duplicateSerials > 0) {
    warnings.push(
      `${duplicateSerials} grupo(s) de número de série duplicado será(ão) preservado(s).`,
    )
  }

  const peopleById = new Map(document.colaboradores.map((person) => [person.id, person]))
  const holderDepartmentDivergences = document.equipamentos.filter((equipment) => {
    if (equipment.current_holder_id === null || equipment.department_id === null) return false
    const personDepartmentId = peopleById.get(equipment.current_holder_id)?.department_id
    return personDepartmentId !== null && personDepartmentId !== equipment.department_id
  }).length
  if (holderDepartmentDivergences > 0) {
    warnings.push(
      `${holderDepartmentDivergences} equipamento(s) possui(em) setor diferente do setor atual do portador; o estado do equipamento será preservado.`,
    )
  }

  const latestMovementByEquipment = new Map<
    number,
    InventoryExportDocument['historico_transferencias'][number]
  >()
  for (const movement of document.historico_transferencias) {
    const current = latestMovementByEquipment.get(movement.equipment_id)
    if (
      !current ||
      movement.data_mudanca > current.data_mudanca ||
      (movement.data_mudanca === current.data_mudanca && movement.id > current.id)
    ) {
      latestMovementByEquipment.set(movement.equipment_id, movement)
    }
  }
  const historyStateDivergences = document.equipamentos.filter((equipment) => {
    const latest = latestMovementByEquipment.get(equipment.id)
    return latest !== undefined && latest.to_person_id !== equipment.current_holder_id
  }).length
  if (historyStateDivergences > 0) {
    warnings.push(
      `${historyStateDivergences} equipamento(s) diverge(m) do destino do último histórico; a custódia atual será mantida como fonte canônica.`,
    )
  }
  return warnings
}

function collectDuplicateIds(items: Array<{ id: number }>, label: string, errors: string[]): void {
  const seen = new Set<number>()
  for (const item of items) {
    if (seen.has(item.id)) errors.push(`${label}: legacy id duplicado ${item.id}.`)
    seen.add(item.id)
  }
}

function collectDuplicateStrings(
  values: Array<string | null>,
  label: string,
  errors: string[],
): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (!value) continue
    const normalized = value.trim().toLocaleLowerCase('pt-BR')
    if (seen.has(normalized)) errors.push(`${label}: valor duplicado ${JSON.stringify(value)}.`)
    seen.add(normalized)
  }
}

function requireReference(
  id: number | null,
  ids: Set<number>,
  label: string,
  errors: string[],
): void {
  if (id !== null && !ids.has(id)) errors.push(`${label}: referência inexistente ${id}.`)
}

function validateReferencesAndUniqueness(document: InventoryExportDocument): string[] {
  const errors: string[] = []
  collectDuplicateIds(document.categorias, 'categorias', errors)
  collectDuplicateIds(document.setores, 'setores', errors)
  collectDuplicateIds(document.locais, 'locais', errors)
  collectDuplicateIds(document.colaboradores, 'colaboradores', errors)
  collectDuplicateIds(document.equipamentos, 'equipamentos', errors)
  collectDuplicateIds(document.historico_transferencias, 'historico_transferencias', errors)
  collectDuplicateIds(document.ramais, 'ramais', errors)
  collectDuplicateIds(document.recebimentos, 'recebimentos', errors)
  collectDuplicateIds(document.abas_personalizadas, 'abas_personalizadas', errors)
  collectDuplicateIds(document.termos, 'termos', errors)
  collectDuplicateIds(document.anexos, 'anexos', errors)
  collectDuplicateIds(document.usuarios_sistema, 'usuarios_sistema', errors)
  collectDuplicateIds(document.auditoria, 'auditoria', errors)
  collectDuplicateIds(
    document.categorias.flatMap((category) => category.campos),
    'campos de categoria',
    errors,
  )
  collectDuplicateIds(
    document.abas_personalizadas.flatMap((customModule) => customModule.campos),
    'campos de módulo',
    errors,
  )
  collectDuplicateIds(
    document.abas_personalizadas.flatMap((customModule) => customModule.registros),
    'registros personalizados',
    errors,
  )

  collectDuplicateStrings(
    document.categorias.map((item) => item.nome),
    'categorias.nome',
    errors,
  )
  collectDuplicateStrings(
    document.setores.map((item) => item.nome),
    'setores.nome',
    errors,
  )
  collectDuplicateStrings(
    document.locais.map((item) => item.nome),
    'locais.nome',
    errors,
  )
  collectDuplicateStrings(
    document.abas_personalizadas.map((item) => item.nome),
    'abas_personalizadas.nome',
    errors,
  )
  collectDuplicateStrings(
    document.equipamentos.map((item) => item.patrimonio),
    'equipamentos.patrimonio',
    errors,
  )
  for (const category of document.categorias) {
    collectDuplicateStrings(
      category.campos.map((item) => item.chave),
      `categoria#${category.id}.campos.chave`,
      errors,
    )
  }
  for (const customModule of document.abas_personalizadas) {
    collectDuplicateStrings(
      customModule.campos.map((item) => item.chave),
      `modulo#${customModule.id}.campos.chave`,
      errors,
    )
  }

  const categoryIds = new Set(document.categorias.map((item) => item.id))
  const departmentIds = new Set(document.setores.map((item) => item.id))
  const locationIds = new Set(document.locais.map((item) => item.id))
  const personIds = new Set(document.colaboradores.map((item) => item.id))
  const equipmentIds = new Set(document.equipamentos.map((item) => item.id))
  const termIds = new Set(document.termos.map((item) => item.id))
  const systemUserIds = new Set(document.usuarios_sistema.map((item) => item.id))
  const recordIds = new Set(
    document.abas_personalizadas.flatMap((customModule) =>
      customModule.registros.map((item) => item.id),
    ),
  )
  const categoryNames = new Map(document.categorias.map((item) => [item.id, item.nome]))

  for (const person of document.colaboradores) {
    requireReference(
      person.department_id,
      departmentIds,
      `colaborador#${person.id}.department_id`,
      errors,
    )
  }
  for (const equipment of document.equipamentos) {
    requireReference(
      equipment.category_id,
      categoryIds,
      `equipamento#${equipment.id}.category_id`,
      errors,
    )
    requireReference(
      equipment.current_holder_id,
      personIds,
      `equipamento#${equipment.id}.current_holder_id`,
      errors,
    )
    requireReference(
      equipment.department_id,
      departmentIds,
      `equipamento#${equipment.id}.department_id`,
      errors,
    )
    requireReference(
      equipment.location_id,
      locationIds,
      `equipamento#${equipment.id}.location_id`,
      errors,
    )
    const expectedName = categoryNames.get(equipment.category_id)
    if (equipment.categoria_nome !== null && equipment.categoria_nome !== expectedName) {
      errors.push(`equipamento#${equipment.id}.categoria_nome diverge da categoria referenciada.`)
    }
  }
  for (const movement of document.historico_transferencias) {
    requireReference(
      movement.equipment_id,
      equipmentIds,
      `movimentacao#${movement.id}.equipment_id`,
      errors,
    )
    requireReference(
      movement.from_person_id,
      personIds,
      `movimentacao#${movement.id}.from_person_id`,
      errors,
    )
    requireReference(
      movement.to_person_id,
      personIds,
      `movimentacao#${movement.id}.to_person_id`,
      errors,
    )
    requireReference(
      movement.from_department_id,
      departmentIds,
      `movimentacao#${movement.id}.from_department_id`,
      errors,
    )
    requireReference(
      movement.to_department_id,
      departmentIds,
      `movimentacao#${movement.id}.to_department_id`,
      errors,
    )
    requireReference(
      movement.performed_by_id ?? null,
      systemUserIds,
      `movimentacao#${movement.id}.performed_by_id`,
      errors,
    )
  }
  for (const term of document.termos) {
    requireReference(term.person_id, personIds, `termo#${term.id}.person_id`, errors)
    requireReference(
      term.destino_person_id,
      personIds,
      `termo#${term.id}.destino_person_id`,
      errors,
    )
  }
  for (const audit of document.auditoria) {
    requireReference(
      audit.performed_by_id ?? null,
      systemUserIds,
      `auditoria#${audit.id}.performed_by_id`,
      errors,
    )
  }
  const attachmentTargets: Record<z.infer<typeof attachmentEntityTypeSchema>, Set<number>> = {
    equipment: equipmentIds,
    person: personIds,
    termo: termIds,
    custom_record: recordIds,
  }
  for (const attachment of document.anexos) {
    requireReference(
      attachment.entity_id,
      attachmentTargets[attachment.entity_type],
      `anexo#${attachment.id}.${attachment.entity_type}`,
      errors,
    )
  }
  return errors
}

function normalizeSecret(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase('pt-BR')
}

function sensitiveKey(key: string, declaredKeys: Set<string>): boolean {
  const normalized = normalizeSecret(key)
  return (
    declaredKeys.has(normalized) ||
    normalized === 'password' ||
    normalized === 'password_hash' ||
    normalized === 'passwd' ||
    normalized === 'secret' ||
    normalized.includes('senha')
  )
}

function redactObject(
  value: JsonValue,
  declaredKeys: Set<string>,
): { value: JsonValue; removed: number } {
  if (Array.isArray(value)) {
    let removed = 0
    const clean = value.map((item) => {
      const redacted = redactObject(item, declaredKeys)
      removed += redacted.removed
      return redacted.value
    })
    return { value: clean, removed }
  }
  if (value && typeof value === 'object') {
    const clean: JsonObject = {}
    let removed = 0
    for (const [key, item] of Object.entries(value)) {
      if (sensitiveKey(key, declaredKeys)) {
        removed += 1
        continue
      }
      const redacted = redactObject(item, declaredKeys)
      removed += redacted.removed
      clean[key] = redacted.value
    }
    return { value: clean, removed }
  }
  return { value, removed: 0 }
}

function sanitizeDocument(document: InventoryExportDocument): ImportSanitizationReport {
  const categorySecretKeys = new Map<number, Set<string>>()
  const categorySecretLabels = new Map<string, Set<string>>()
  for (const category of document.categorias) {
    const passwordFields = category.campos.filter((field) => field.tipo === 'senha')
    categorySecretKeys.set(
      category.id,
      new Set(passwordFields.map((field) => normalizeSecret(field.chave))),
    )
    categorySecretLabels.set(
      category.nome,
      new Set(passwordFields.map((field) => normalizeSecret(field.rotulo))),
    )
  }
  const moduleSecretKeys = new Map<number, Set<string>>()
  for (const customModule of document.abas_personalizadas) {
    moduleSecretKeys.set(
      customModule.id,
      new Set(
        customModule.campos
          .filter((field) => field.tipo === 'senha')
          .map((field) => normalizeSecret(field.chave)),
      ),
    )
  }

  let passwordFieldOptionsRemoved = 0
  for (const field of [
    ...document.categorias.flatMap((category) => category.campos),
    ...document.abas_personalizadas.flatMap((customModule) => customModule.campos),
  ]) {
    if (field.tipo === 'senha' && field.opcoes !== null) {
      field.opcoes = null
      passwordFieldOptionsRemoved += 1
    }
  }

  let equipmentPasswordValuesRemoved = 0
  for (const equipment of document.equipamentos) {
    const redacted = redactObject(
      equipment.specs,
      categorySecretKeys.get(equipment.category_id) ?? new Set(),
    )
    equipmentPasswordValuesRemoved += redacted.removed
    equipment.specs = redacted.value as JsonObject
  }

  let customRecordPasswordValuesRemoved = 0
  for (const customModule of document.abas_personalizadas) {
    for (const record of customModule.registros) {
      const redacted = redactObject(
        record.dados,
        moduleSecretKeys.get(customModule.id) ?? new Set(),
      )
      customRecordPasswordValuesRemoved += redacted.removed
      record.dados = redacted.value as JsonObject
    }
  }

  let termPasswordValuesRemoved = 0
  for (const term of document.termos) {
    term.itens = term.itens.map((item) => {
      const category = typeof item.categoria === 'string' ? item.categoria : ''
      const labels = categorySecretLabels.get(category) ?? new Set<string>()
      const summary = item.resumo
      if (typeof summary === 'string' && labels.size > 0) {
        const parts = summary.split(' · ')
        const kept = parts.filter((part) => {
          const separator = part.indexOf(':')
          if (separator < 0 || !labels.has(normalizeSecret(part.slice(0, separator)))) return true
          termPasswordValuesRemoved += 1
          return false
        })
        item = { ...item, resumo: kept.join(' · ') }
      }
      const categoryDefinition = document.categorias.find(
        (candidate) => candidate.nome === category,
      )
      const redacted = redactObject(
        item,
        categoryDefinition
          ? (categorySecretKeys.get(categoryDefinition.id) ?? new Set())
          : new Set(),
      )
      termPasswordValuesRemoved += redacted.removed
      return redacted.value as JsonObject
    })
  }

  let auditPasswordValuesRemoved = 0
  const allSecretKeys = new Set<string>()
  for (const keys of categorySecretKeys.values()) for (const key of keys) allSecretKeys.add(key)
  for (const keys of moduleSecretKeys.values()) for (const key of keys) allSecretKeys.add(key)
  for (const entry of document.auditoria) {
    if (sensitiveKey(entry.campo ?? '', allSecretKeys)) {
      if (entry.valor_antigo !== null) auditPasswordValuesRemoved += 1
      if (entry.valor_novo !== null) auditPasswordValuesRemoved += 1
      entry.valor_antigo = null
      entry.valor_novo = null
      continue
    }
    for (const key of ['valor_antigo', 'valor_novo'] as const) {
      const value = entry[key]
      if (value === null) continue
      try {
        const parsed = JSON.parse(value) as JsonValue
        const redacted = redactObject(parsed, allSecretKeys)
        if (redacted.removed > 0) {
          entry[key] = JSON.stringify(redacted.value)
          auditPasswordValuesRemoved += redacted.removed
        }
      } catch {
        // Texto livre não estruturado só é removido quando o próprio nome do
        // campo indica segredo; não tentamos inferir ou registrar seu conteúdo.
      }
    }
  }

  return {
    passwordFieldOptionsRemoved,
    equipmentPasswordValuesRemoved,
    customRecordPasswordValuesRemoved,
    termPasswordValuesRemoved,
    auditPasswordValuesRemoved,
  }
}

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function normalizeDynamicData(
  data: JsonObject,
  fields: Array<{
    chave: string
    tipo: z.infer<typeof legacyFieldTypeSchema>
    opcoes: string | null
  }>,
  path: string,
  report: ImportNormalizationReport,
  errors: string[],
  quarantine?: JsonObject,
): JsonObject {
  const definitions = new Map(fields.map((field) => [field.chave, field]))
  const normalized: JsonObject = {}
  for (const [key, original] of Object.entries(data)) {
    const definition = definitions.get(key)
    if (!definition) {
      errors.push(`${path}.${key}: campo dinâmico não está declarado.`)
      continue
    }
    const type = definition.tipo
    if (type === 'senha') {
      errors.push(`${path}.${key}: valor PASSWORD permaneceu após o saneamento.`)
      continue
    }
    if (original === null) {
      normalized[key] = null
      continue
    }
    if (type === 'numero') {
      if (typeof original === 'number' && Number.isFinite(original)) {
        normalized[key] = original
        continue
      }
      if (typeof original === 'string') {
        const value = original.trim()
        if (value === '') {
          normalized[key] = null
          report.numberValuesNormalized += 1
          continue
        }
        if (/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value)) {
          const parsed = Number(value.replace(',', '.'))
          if (Number.isFinite(parsed)) {
            normalized[key] = parsed
            report.numberValuesNormalized += 1
            continue
          }
        }
      }
      errors.push(`${path}.${key}: NUMBER inválido (${JSON.stringify(original)}).`)
      continue
    }
    if (type === 'booleano') {
      if (typeof original === 'boolean') {
        normalized[key] = original
        continue
      }
      const value = typeof original === 'string' ? normalizeSecret(original) : original
      if (value === '' || value === null) {
        normalized[key] = null
        report.booleanValuesNormalized += 1
        continue
      }
      if (value === 1 || ['1', 'true', 'sim', 's'].includes(String(value))) {
        normalized[key] = true
        report.booleanValuesNormalized += 1
        continue
      }
      if (value === 0 || ['0', 'false', 'nao', 'não', 'n'].includes(String(value))) {
        normalized[key] = false
        report.booleanValuesNormalized += 1
        continue
      }
      errors.push(`${path}.${key}: BOOLEAN inválido (${JSON.stringify(original)}).`)
      continue
    }
    if (type === 'data') {
      if (typeof original !== 'string') {
        errors.push(`${path}.${key}: DATE deve ser texto AAAA-MM-DD.`)
        continue
      }
      const value = original.trim()
      if (value === '') {
        normalized[key] = null
        report.dateValuesNormalized += 1
        continue
      }
      if (validDateOnly(value)) {
        normalized[key] = value
        continue
      }
      const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
      if (brazilian) {
        const converted = `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`
        if (validDateOnly(converted)) {
          normalized[key] = converted
          report.dateValuesNormalized += 1
          continue
        }
      }
      errors.push(`${path}.${key}: DATE inválido (${JSON.stringify(original)}).`)
      continue
    }
    if (type === 'mac') {
      if (
        typeof original === 'string' &&
        /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(original)
      ) {
        normalized[key] = original
      } else if (quarantine) {
        quarantine[key] = original
        report.legacyValuesQuarantined += 1
      } else {
        errors.push(`${path}.${key}: MAC inválido.`)
      }
      continue
    }
    if (type === 'ip') {
      if (
        typeof original === 'string' &&
        /^([0-9]{1,3}\.){3}[0-9]{1,3}$/.test(original) &&
        original.split('.').every((part) => Number(part) <= 255)
      ) {
        normalized[key] = original
      } else if (quarantine) {
        quarantine[key] = original
        report.legacyValuesQuarantined += 1
      } else {
        errors.push(`${path}.${key}: IP inválido.`)
      }
      continue
    }
    if (type === 'selecao') {
      const options = parseOptions(definition.opcoes)
      if (typeof original !== 'string' || (options.length > 0 && !options.includes(original))) {
        errors.push(`${path}.${key}: SELECT inválido.`)
        continue
      }
    }
    if ((type === 'texto' || type === 'area') && typeof original !== 'string') {
      errors.push(`${path}.${key}: texto inválido.`)
      continue
    }
    normalized[key] = original
  }
  return normalized
}

function normalizeDocumentDynamicValues(document: InventoryExportDocument): {
  report: ImportNormalizationReport
  quarantine: PreparedInventoryExport['quarantine']
} {
  const report: ImportNormalizationReport = {
    numberValuesNormalized: 0,
    booleanValuesNormalized: 0,
    dateValuesNormalized: 0,
    legacyValuesQuarantined: 0,
    equipmentWithQuarantinedValues: 0,
  }
  const quarantine: PreparedInventoryExport['quarantine'] = { equipment: new Map() }
  const errors: string[] = []
  const categoryFields = new Map(
    document.categorias.map((category) => [category.id, category.campos]),
  )
  for (const equipment of document.equipamentos) {
    const invalid: JsonObject = {}
    equipment.specs = normalizeDynamicData(
      equipment.specs,
      categoryFields.get(equipment.category_id) ?? [],
      `equipamento#${equipment.id}.specs`,
      report,
      errors,
      invalid,
    )
    if (Object.keys(invalid).length > 0) {
      quarantine.equipment.set(equipment.id, invalid)
      report.equipmentWithQuarantinedValues += 1
    }
  }
  for (const customModule of document.abas_personalizadas) {
    for (const record of customModule.registros) {
      record.dados = normalizeDynamicData(
        record.dados,
        customModule.campos,
        `registro#${record.id}.dados`,
        report,
        errors,
      )
    }
  }
  if (errors.length > 0) {
    throw new InventoryImportValidationError(
      'Há valores dinâmicos incompatíveis com o FieldType.',
      errors,
    )
  }
  return { report, quarantine }
}

function requireV2Fields(document: InventoryExportDocument): string[] {
  if (document._meta.versao !== 2) return []
  const missing: string[] = []
  const requireKey = (object: object, key: string, label: string) => {
    if (!Object.prototype.hasOwnProperty.call(object, key))
      missing.push(`${label}.${key} é obrigatório no formato v2.`)
  }
  for (const item of document.setores) requireKey(item, 'created_at', `setor#${item.id}`)
  for (const item of document.locais) requireKey(item, 'created_at', `local#${item.id}`)
  for (const item of document.colaboradores)
    requireKey(item, 'created_at', `colaborador#${item.id}`)
  for (const item of document.historico_transferencias)
    requireKey(item, 'performed_by_id', `movimentacao#${item.id}`)
  for (const item of document.ramais) requireKey(item, 'created_at', `ramal#${item.id}`)
  for (const item of document.recebimentos) requireKey(item, 'created_at', `recebimento#${item.id}`)
  for (const customModule of document.abas_personalizadas) {
    requireKey(customModule, 'created_at', `modulo#${customModule.id}`)
    for (const record of customModule.registros)
      requireKey(record, 'updated_at', `registro#${record.id}`)
  }
  for (const item of document.usuarios_sistema) {
    requireKey(item, 'ultimo_acesso', `usuario#${item.id}`)
    requireKey(item, 'created_at', `usuario#${item.id}`)
  }
  for (const item of document.auditoria) requireKey(item, 'performed_by_id', `auditoria#${item.id}`)
  return missing
}

export function prepareInventoryExport(raw: Uint8Array): PreparedInventoryExport {
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    throw new InventoryImportValidationError('O arquivo não é UTF-8 válido.')
  }

  let unknownDocument: unknown
  try {
    unknownDocument = JSON.parse(decoded.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new InventoryImportValidationError('JSON legado malformado.', [
      error instanceof Error ? error.message : String(error),
    ])
  }
  if (!unknownDocument || typeof unknownDocument !== 'object' || !('_meta' in unknownDocument)) {
    throw new InventoryImportValidationError('Documento sem _meta.')
  }
  const version = (unknownDocument as { _meta?: { versao?: unknown } })._meta?.versao
  const schema = version === 1 ? documentV1Schema : version === 2 ? documentV2Schema : null
  if (!schema)
    throw new InventoryImportValidationError(
      `Versão de exportação não suportada: ${String(version)}.`,
    )

  const parsed = schema.safeParse(unknownDocument)
  if (!parsed.success) {
    throw new InventoryImportValidationError(
      'O JSON não corresponde ao formato legado suportado.',
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<raiz>'}: ${issue.message}`),
    )
  }
  const document = parsed.data as InventoryExportDocument
  const rawSha256 = sha256(raw)
  const sections = Object.fromEntries(Object.entries(document).filter(([key]) => key !== '_meta'))
  const canonicalSha256 = sha256(
    document._meta.versao === 2 && !document._meta.fingerprint.canonizacao
      ? stableJsonStringify(sections)
      : canonicalFingerprintBytes(sections),
  )
  const errors = [...requireV2Fields(document), ...validateReferencesAndUniqueness(document)]
  const counts = computeInventoryCounts(document)

  if (document._meta.versao === 2) {
    for (const key of INVENTORY_COUNT_KEYS) {
      if (document._meta.manifesto_contagens[key] !== counts[key]) {
        errors.push(
          `manifesto_contagens.${key}: esperado ${document._meta.manifesto_contagens[key]}, lido ${counts[key]}.`,
        )
      }
    }
    if (document._meta.segredos_removidos.users_password_hash_omitidos !== counts.users) {
      errors.push(
        'segredos_removidos.users_password_hash_omitidos diverge da quantidade de usuários.',
      )
    }
    const declaredPasswordFields = [
      ...document.categorias.flatMap((category) => category.campos),
      ...document.abas_personalizadas.flatMap((customModule) => customModule.campos),
    ].filter((field) => field.tipo === 'senha').length
    if (document._meta.segredos_removidos.campos_senha_declarados !== declaredPasswordFields) {
      errors.push(
        'segredos_removidos.campos_senha_declarados diverge das definições PASSWORD exportadas.',
      )
    }
    if (document._meta.fingerprint.valor !== canonicalSha256) {
      errors.push(
        'Fingerprint canônico v2 inválido; o conteúdo pode ter sido alterado após a exportação.',
      )
    }
  }
  if (errors.length > 0)
    throw new InventoryImportValidationError(
      'Falha nas invariantes do export de inventário.',
      errors,
    )

  const sanitization = sanitizeDocument(document)
  const removed = Object.values(sanitization).reduce((total, value) => total + value, 0)
  if (document._meta.versao === 2 && removed > 0) {
    throw new InventoryImportValidationError(
      'O formato seguro v2 ainda contém valores de senha e foi rejeitado.',
      [JSON.stringify(sanitization)],
    )
  }
  const { report: normalization, quarantine } = normalizeDocumentDynamicValues(document)
  const warnings: string[] = []
  if (removed > 0)
    warnings.push(
      `${removed} valor(es) sensível(is) do formato v1 foram removidos antes do planejamento.`,
    )
  if (counts.users > 0)
    warnings.push(
      `${counts.users} usuário(s) do Flask serão ignorados; nunca serão criados como BitrixUser.`,
    )
  if (counts.attachments > 0)
    warnings.push(`${counts.attachments} anexo(s) sem bytes/blob serão reportados e ignorados.`)
  warnings.push(...dataQualityWarnings(document))
  if (normalization.legacyValuesQuarantined > 0) {
    warnings.push(
      `${normalization.legacyValuesQuarantined} valor(es) MAC/IP inválido(s) de ${normalization.equipmentWithQuarantinedValues} equipamento(s) foi(ram) separado(s) para revisão (legacy IDs: ${[...quarantine.equipment.keys()].join(', ')}).`,
    )
  }

  return {
    document,
    rawSha256,
    canonicalSha256,
    counts,
    sanitization,
    normalization,
    quarantine,
    warnings,
  }
}

export function parseOptions(value: string | null): string[] {
  if (!value) return []
  return value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
}

export const LEGACY_ENUM_MAPS = {
  equipmentStatus: {
    ativo: 'ACTIVE',
    estoque: 'STOCK',
    manutencao: 'MAINTENANCE',
    quebrado: 'BROKEN',
    emprestado: 'LOANED',
    inativo: 'INACTIVE',
  },
  personStatus: { ativo: 'ACTIVE', afastado: 'ON_LEAVE', desligado: 'TERMINATED' },
  employmentType: {
    clt: 'CLT',
    pj: 'PJ',
    estagio: 'INTERN',
    temporario: 'TEMPORARY',
    outro: 'OTHER',
  },
  fieldType: {
    texto: 'TEXT',
    area: 'TEXTAREA',
    numero: 'NUMBER',
    data: 'DATE',
    selecao: 'SELECT',
    booleano: 'BOOLEAN',
    senha: 'PASSWORD',
    mac: 'MAC',
    ip: 'IP',
  },
  movementOrigin: { manual: 'MANUAL', importacao: 'IMPORT' },
  termType: {
    entrega: 'DELIVERY',
    responsabilidade: 'RESPONSIBILITY',
    devolucao: 'RETURN',
    transferencia: 'TRANSFER',
  },
} as const

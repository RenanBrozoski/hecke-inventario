import {
  InventoryEmploymentType,
  InventoryCorporateLineStatus,
  InventoryEquipmentStatus,
  InventoryFieldType,
  InventoryMatchStatus,
  InventoryPersonStatus,
  InventoryRole,
  InventoryTermType,
} from '@prisma/client'
import { z } from 'zod'

const id = z.string().trim().min(1).max(100)
const nullableText = (max: number) => z.union([z.string().trim().min(1).max(max), z.null()])
const optionalNullableText = (max: number) => nullableText(max).optional()
const dateOnlyString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use uma data no formato AAAA-MM-DD.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, 'Data inválida.')

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
})

export function searchParamsObject(url: URL): Record<string, string> {
  return Object.fromEntries(url.searchParams.entries())
}

export const equipmentListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(InventoryEquipmentStatus).optional(),
  categoryId: id.optional(),
  categoryIds: z
    .string()
    .trim()
    .max(2000)
    .transform((value, context) => {
      const ids = value.split(',').map((item) => item.trim()).filter(Boolean)
      if (!ids.length || ids.some((item) => item.length > 100)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Categorias inválidas.' })
        return z.NEVER
      }
      return [...new Set(ids)]
    })
    .optional(),
  holderId: id.optional(),
  departmentId: id.optional(),
  locationId: id.optional(),
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
  sort: z
    .enum([
      'updatedAt',
      'createdAt',
      'patrimony',
      'name',
      'category',
      'status',
      'holder',
      'department',
      'location',
    ])
    .default('updatedAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
})

const equipmentMutableShape = {
  patrimony: optionalNullableText(100),
  assetTag: optionalNullableText(100),
  name: optionalNullableText(200),
  categoryId: id.optional(),
  status: z.nativeEnum(InventoryEquipmentStatus).optional(),
  currentHolderId: z.union([id, z.null()]).optional(),
  departmentId: z.union([id, z.null()]).optional(),
  locationId: z.union([id, z.null()]).optional(),
  locationDetail: optionalNullableText(500),
  serialNumber: optionalNullableText(200),
  invoiceNumber: optionalNullableText(200),
  acquiredAt: z.union([dateOnlyString, z.null()]).optional(),
  receivedAt: z.union([dateOnlyString, z.null()]).optional(),
  deliveredAt: z.union([dateOnlyString, z.null()]).optional(),
  warrantyEndsAt: z.union([dateOnlyString, z.null()]).optional(),
  specs: z.record(z.string().min(1).max(100), z.unknown()).optional(),
  notes: optionalNullableText(5000),
}

export const createEquipmentSchema = z
  .object({
    ...equipmentMutableShape,
    categoryId: id,
  })
  .strict()

export const updateEquipmentSchema = z
  .object({ revision: z.number().int().min(1), ...equipmentMutableShape })
  .strict()
  .refine((body) => Object.keys(body).some((key) => key !== 'revision'), {
    message: 'Informe ao menos um campo para atualizar.',
  })

export const transferEquipmentSchema = z
  .object({
    revision: z.number().int().min(1),
    toPersonId: z.union([id, z.null()]).optional(),
    toDepartmentId: z.union([id, z.null()]).optional(),
    locationId: z.union([id, z.null()]).optional(),
    status: z.nativeEnum(InventoryEquipmentStatus).optional(),
    movedAt: dateOnlyString.optional(),
    reason: optionalNullableText(1000),
    // IMPORT/INITIAL_REGISTRATION são reservados a fluxos internos; o
    // cliente autenticado pode registrar apenas operação manual/em lote.
    origin: z.enum(['MANUAL', 'BULK_TRANSFER']).default('MANUAL'),
  })
  .strict()
  .refine(
    (body) =>
      body.toPersonId !== undefined ||
      body.toDepartmentId !== undefined ||
      body.locationId !== undefined ||
      body.status !== undefined,
    { message: 'Informe ao menos um destino, local ou status.' },
  )

export const bulkTransferSchema = z
  .object({
    equipmentIds: z.array(id).min(1).max(200),
    expectedRevisions: z.record(z.string(), z.number().int().min(1)),
    destinationPersonId: z.union([id, z.null()]),
    movedAt: dateOnlyString,
    reason: optionalNullableText(1000),
    createTerm: z.boolean().default(true),
  })
  .strict()
  .superRefine((body, context) => {
    const uniqueIds = new Set(body.equipmentIds)
    if (uniqueIds.size !== body.equipmentIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['equipmentIds'],
        message: 'equipmentIds não pode conter IDs repetidos.',
      })
    }

    const revisionIds = Object.keys(body.expectedRevisions)
    for (const equipmentId of uniqueIds) {
      if (!Object.prototype.hasOwnProperty.call(body.expectedRevisions, equipmentId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expectedRevisions', equipmentId],
          message: 'Informe a revisão esperada deste equipamento.',
        })
      }
    }
    for (const equipmentId of revisionIds) {
      if (!uniqueIds.has(equipmentId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expectedRevisions', equipmentId],
          message: 'A revisão informada não corresponde a um equipmentId selecionado.',
        })
      }
    }
  })

export const peopleListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(InventoryPersonStatus).optional(),
  departmentId: id.optional(),
  employmentType: z.nativeEnum(InventoryEmploymentType).optional(),
  bitrixMatchStatus: z.nativeEnum(InventoryMatchStatus).optional(),
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
})

const corporateLineMutableShape = {
  number: z.string().trim().min(3).max(50).optional(),
  carrier: optionalNullableText(100),
  plan: optionalNullableText(200),
  dataAllowance: optionalNullableText(100),
  status: z.nativeEnum(InventoryCorporateLineStatus).optional(),
  currentHolderId: z.union([id, z.null()]).optional(),
  equipmentId: z.union([id, z.null()]).optional(),
  simSlot: optionalNullableText(100),
  activatedAt: z.union([dateOnlyString, z.null()]).optional(),
  suspendedAt: z.union([dateOnlyString, z.null()]).optional(),
  cancelledAt: z.union([dateOnlyString, z.null()]).optional(),
  notes: optionalNullableText(5000),
}

export const corporateLineListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  status: z.nativeEnum(InventoryCorporateLineStatus).optional(),
  holderId: id.optional(),
  equipmentId: id.optional(),
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
})

export const createCorporateLineSchema = z
  .object({ ...corporateLineMutableShape, number: z.string().trim().min(3).max(50) })
  .strict()

export const updateCorporateLineSchema = z
  .object({ revision: z.number().int().min(1), ...corporateLineMutableShape })
  .strict()
  .refine((body) => Object.keys(body).some((key) => key !== 'revision'), {
    message: 'Informe ao menos um campo para atualizar.',
  })

export const corporateLineDeleteQuerySchema = z.object({
  revision: z.coerce.number().int().min(1),
})

const personMutableShape = {
  name: z.string().trim().min(1).max(200).optional(),
  departmentId: z.union([id, z.null()]).optional(),
  title: optionalNullableText(200),
  email: z.union([z.string().trim().email().max(320), z.null()]).optional(),
  cpf: optionalNullableText(20),
  employeeNumber: optionalNullableText(100),
  employmentType: z.union([z.nativeEnum(InventoryEmploymentType), z.null()]).optional(),
  status: z.nativeEnum(InventoryPersonStatus).optional(),
  notes: optionalNullableText(5000),
  bitrixUserId: optionalNullableText(100),
}

export const createPersonSchema = z
  .object({ ...personMutableShape, name: z.string().trim().min(1).max(200) })
  .strict()
export const updatePersonSchema = z
  .object({ revision: z.number().int().min(1), ...personMutableShape })
  .strict()
  .refine((body) => Object.keys(body).some((key) => key !== 'revision'), {
    message: 'Informe ao menos um campo para atualizar.',
  })

export const namedResourceSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: optionalNullableText(2000),
    active: z.boolean().optional(),
  })
  .strict()

export const updateNamedResourceSchema = namedResourceSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  })

export const categorySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    prefix: optionalNullableText(30),
    icon: z.string().trim().min(1).max(100).optional(),
    description: optionalNullableText(2000),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    active: z.boolean().optional(),
  })
  .strict()

export const updateCategorySchema = categorySchema
  .partial()
  .extend({ revision: z.number().int().min(1) })
  .refine((body) => Object.keys(body).some((key) => key !== 'revision'), {
    message: 'Informe ao menos um campo para atualizar.',
  })

const fieldShape = {
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,63}$/, 'Use letras minúsculas, números e underscore.'),
  label: z.string().trim().min(1).max(200),
  type: z.nativeEnum(InventoryFieldType).optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  required: z.boolean().optional(),
  listVisible: z.boolean().optional(),
  active: z.boolean().optional(),
}

function validateFieldDefinition(
  body: { type?: InventoryFieldType; options?: string[]; required?: boolean },
  context: z.RefinementCtx,
) {
  if (body.type !== undefined && body.type !== InventoryFieldType.SELECT && body.options?.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['options'],
      message: 'Opções só podem ser informadas para campos SELECT.',
    })
  }
  if (body.type === InventoryFieldType.PASSWORD && body.required) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['required'],
      message: 'Campos PASSWORD não podem ser obrigatórios.',
    })
  }
}

export const fieldSchema = z.object(fieldShape).strict().superRefine(validateFieldDefinition)
export const updateFieldSchema = z
  .object(fieldShape)
  .strict()
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  })
  .superRefine(validateFieldDefinition)

export const roleAssignmentSchema = z
  .object({ bitrixUserId: id, role: z.nativeEnum(InventoryRole) })
  .strict()

export const extensionSchema = z
  .object({
    number: optionalNullableText(100),
    collaborator: optionalNullableText(200),
    department: optionalNullableText(200),
    type: optionalNullableText(100),
    active: z.boolean().optional(),
    notes: optionalNullableText(5000),
  })
  .strict()
export const updateExtensionSchema = extensionSchema.refine(
  (body) => Object.keys(body).length > 0,
  {
    message: 'Informe ao menos um campo para atualizar.',
  },
)

export const receivingSchema = z
  .object({
    receivedAt: z.union([dateOnlyString, z.null()]).optional(),
    equipment: optionalNullableText(500),
    quantity: z.number().int().min(1).max(100000).optional(),
    tag: optionalNullableText(100),
    deliveredAt: z.union([dateOnlyString, z.null()]).optional(),
    deliveredTo: optionalNullableText(200),
    notes: optionalNullableText(5000),
  })
  .strict()
export const updateReceivingSchema = receivingSchema.refine(
  (body) => Object.keys(body).length > 0,
  {
    message: 'Informe ao menos um campo para atualizar.',
  },
)

export const termSchema = z
  .object({
    type: z
      .enum([
        InventoryTermType.DELIVERY,
        InventoryTermType.RESPONSIBILITY,
        InventoryTermType.RETURN,
      ])
      .default(InventoryTermType.RESPONSIBILITY),
    personId: id,
    equipmentIds: z.array(id).min(1).max(500),
    expectedRevisions: z.record(z.string(), z.number().int().min(1)),
    observations: optionalNullableText(10000),
  })
  .strict()
  .superRefine((body, context) => {
    if (new Set(body.equipmentIds).size !== body.equipmentIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['equipmentIds'],
        message: 'equipmentIds não pode conter IDs repetidos.',
      })
    }
    const revisionIds = Object.keys(body.expectedRevisions)
    for (const equipmentId of body.equipmentIds) {
      if (!Object.prototype.hasOwnProperty.call(body.expectedRevisions, equipmentId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expectedRevisions', equipmentId],
          message: 'Informe a revisão esperada de cada equipamento.',
        })
      }
    }
    for (const equipmentId of revisionIds) {
      if (!body.equipmentIds.includes(equipmentId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expectedRevisions', equipmentId],
          message: 'A revisão informada não pertence à seleção.',
        })
      }
    }
  })

export const customModuleSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    icon: z.string().trim().min(1).max(100).optional(),
    description: optionalNullableText(2000),
    titleLabel: z.string().trim().min(1).max(100).optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    active: z.boolean().optional(),
  })
  .strict()

export const updateCustomModuleSchema = customModuleSchema
  .partial()
  .extend({ revision: z.number().int().min(1) })
  .refine((body) => Object.keys(body).some((key) => key !== 'revision'), {
    message: 'Informe ao menos um campo para atualizar.',
  })

const customModuleFieldObject = z
  .object({ ...fieldShape, expiryAlert: z.boolean().optional() })
  .strict()
export const customModuleFieldSchema = customModuleFieldObject.superRefine(validateFieldDefinition)
export const updateCustomModuleFieldSchema = customModuleFieldObject
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  })
  .superRefine(validateFieldDefinition)

export const customRecordSchema = z
  .object({
    title: optionalNullableText(500),
    data: z.record(z.string().min(1).max(100), z.unknown()).optional(),
  })
  .strict()

export const updateCustomRecordSchema = customRecordSchema
  .extend({ revision: z.number().int().min(1) })
  .refine((body) => Object.keys(body).some((key) => key !== 'revision'), {
    message: 'Informe ao menos um campo para atualizar.',
  })

export const secondaryListQuerySchema = paginationQuerySchema.extend({
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
  activeFilter: z.enum(['active', 'inactive']).optional(),
})

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>
export type TransferEquipmentInput = z.infer<typeof transferEquipmentSchema>
export type BulkTransferInput = z.infer<typeof bulkTransferSchema>
export type CreatePersonInput = z.infer<typeof createPersonSchema>
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>
export type CreateCorporateLineInput = z.infer<typeof createCorporateLineSchema>
export type UpdateCorporateLineInput = z.infer<typeof updateCorporateLineSchema>

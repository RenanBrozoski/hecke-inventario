export type InventoryRole = 'ADMIN' | 'OPERATOR' | 'VIEWER'
export type EquipmentStatus = 'ACTIVE' | 'STOCK' | 'MAINTENANCE' | 'BROKEN' | 'LOANED' | 'LOST' | 'INACTIVE'
export type PersonStatus = 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED'
export type EmploymentType = 'CLT' | 'PJ' | 'INTERN' | 'TEMPORARY' | 'OTHER'
export type CorporateLineStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'AVAILABLE'
export type FieldType =
  'TEXT' | 'TEXTAREA' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN' | 'PASSWORD' | 'MAC' | 'IP' | 'RAM'

export interface InventoryContextResponse {
  role: InventoryRole
  canEdit: boolean
  canAdmin: boolean
  bitrixUserId?: string
  userName?: string
}

export interface InventoryContextApiResponse {
  context: {
    role: InventoryRole
    bitrixUserId: string
    userName: string
  }
}

export interface InventoryFieldLookup {
  id: string
  key: string
  label: string
  type: FieldType
  options: string[]
  required: boolean
  listVisible: boolean
  active?: boolean
  sortOrder: number
}

export interface CategoryLookup {
  id: string
  name: string
  prefix?: string | null
  icon?: string | null
  fields?: InventoryFieldLookup[]
}

export interface NamedLookup {
  id: string
  name: string
  description?: string | null
}

export interface PersonLookup extends NamedLookup {
  departmentId?: string | null
  status?: PersonStatus
}

export interface InventoryLookupsResponse {
  categories: CategoryLookup[]
  departments: NamedLookup[]
  locations: NamedLookup[]
  people: PersonLookup[]
}

export interface EquipmentSummary {
  id: string
  patrimony: string | null
  assetTag: string | null
  name: string | null
  status: EquipmentStatus
  revision: number
  archivedAt?: string | null
  category: NamedLookup & { fields?: InventoryFieldLookup[] }
  currentHolder?: PersonLookup | null
  department?: NamedLookup | null
  location?: NamedLookup | null
  serialNumber?: string | null
  updatedAt?: string
  specs?: Record<string, unknown>
}

export interface InventoryMovement {
  id: string
  movedAt: string
  reason?: string | null
  origin: string
  fromPersonName?: string | null
  toPersonName?: string | null
  fromDepartmentName?: string | null
  toDepartmentName?: string | null
  performedByName?: string | null
  createdAt: string
  equipment?: { id: string; patrimony?: string | null; name?: string | null }
}

export interface EquipmentAuditEvent {
  id: string
  action: string
  bitrixUserId: string
  userName: string | null
  createdAt: string
  metadata: Record<string, unknown> | null
}

export interface EquipmentDetail extends EquipmentSummary {
  currentHolderId?: string | null
  departmentId?: string | null
  locationId?: string | null
  categoryId: string
  locationDetail?: string | null
  invoiceNumber?: string | null
  acquiredAt?: string | null
  receivedAt?: string | null
  deliveredAt?: string | null
  warrantyEndsAt?: string | null
  specs: Record<string, unknown>
  legacyInvalidSpecs?: Record<string, unknown>
  notes?: string | null
  createdAt: string
  movements?: InventoryMovement[]
  auditEvents?: EquipmentAuditEvent[]
}

export interface EquipmentListResponse {
  items: EquipmentSummary[]
  total: number
  page: number
  pageSize: number
  totalPages?: number
}

export interface EquipmentCodeSuggestion {
  prefix: string | null
  lastCode: string | null
  suggestedCode: string | null
}

export interface PersonSummary {
  id: string
  revision: number
  name: string
  status: PersonStatus
  title?: string | null
  email?: string | null
  cpf?: string | null
  employeeNumber?: string | null
  employmentType?: EmploymentType | null
  bitrixUserId?: string | null
  bitrixMatchStatus?: string
  archivedAt?: string | null
  department?: NamedLookup | null
  _count?: { equipment?: number }
}

export interface PersonDetail extends PersonSummary {
  departmentId?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
  equipment?: EquipmentSummary[]
  movements?: InventoryMovement[]
  movementHistory?: InventoryMovement[]
  extensions?: Array<{ id: string; number?: string | null; type?: string | null; notes?: string | null }>
  corporateLines?: CorporateLine[]
  audit?: Array<{ id: string; action: string; metadata?: unknown; createdAt: string; bitrixUserId: string }>
  termsAsOrigin?: Array<{ id: string; type: string; createdAt: string; items: unknown }>
}

export interface CorporateLine {
  id: string
  number: string
  normalizedNumber: string
  carrier?: string | null
  plan?: string | null
  dataAllowance?: string | null
  status: CorporateLineStatus
  revision: number
  currentHolder?: PersonLookup | null
  equipment?: {
    id: string
    patrimony?: string | null
    assetTag?: string | null
    name?: string | null
    category?: NamedLookup
  } | null
  simSlot?: string | null
  activatedAt?: string | null
  suspendedAt?: string | null
  cancelledAt?: string | null
  notes?: string | null
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
  history?: Array<{
    id: string
    action: string
    origin: string
    fromHolderName?: string | null
    toHolderName?: string | null
    fromEquipmentName?: string | null
    toEquipmentName?: string | null
    fromStatus?: CorporateLineStatus | null
    toStatus?: CorporateLineStatus | null
    fromSimSlot?: string | null
    toSimSlot?: string | null
    performedByName?: string | null
    createdAt: string
  }>
}

export interface CorporateLineListResponse {
  items: CorporateLine[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface PeopleListResponse {
  items: PersonSummary[]
  total: number
  page: number
  pageSize: number
  totalPages?: number
}

export interface DashboardResponse {
  counts: {
    equipment: number
    people: number
    categories?: number
    activePeople?: number
    departments: number
    locations?: number
    extensions?: number
    receivings?: number
    withoutHolder?: number
    expiringSoon?: number
    expired?: number
    linesWithoutEquipment?: number
    peopleWithoutEquipment?: number
  }
  equipmentByStatus: Partial<Record<EquipmentStatus, number>>
  equipmentByCategory: Array<{
    id?: string
    name?: string
    category?: { id: string; name: string }
    count: number
  }>
  recentMovements: InventoryMovement[]
  recentAudit?: Array<{
    id: string
    action: string
    entityType: string
    entityId: string
    bitrixUserId: string
    createdAt: string
  }>
}

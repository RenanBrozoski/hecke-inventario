export type InventoryRole = 'ADMIN' | 'OPERATOR' | 'VIEWER'
export type EquipmentStatus = 'ACTIVE' | 'STOCK' | 'MAINTENANCE' | 'BROKEN' | 'LOANED' | 'INACTIVE'
export type PersonStatus = 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED'
export type EmploymentType = 'CLT' | 'PJ' | 'INTERN' | 'TEMPORARY' | 'OTHER'
export type FieldType =
  'TEXT' | 'TEXTAREA' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN' | 'PASSWORD' | 'MAC' | 'IP'

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
  category: NamedLookup
  currentHolder?: PersonLookup | null
  department?: NamedLookup | null
  location?: NamedLookup | null
  serialNumber?: string | null
  updatedAt?: string
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
}

export interface EquipmentListResponse {
  items: EquipmentSummary[]
  total: number
  page: number
  pageSize: number
  totalPages?: number
}

export interface PersonSummary {
  id: string
  revision: number
  name: string
  status: PersonStatus
  title?: string | null
  email?: string | null
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
  termsAsOrigin?: Array<{ id: string; type: string; createdAt: string; items: unknown }>
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

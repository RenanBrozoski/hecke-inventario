import type { InventoryExportDocument } from './import-format'

export type ReconciliationStatus = 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED'

export interface BitrixDepartmentForReconciliation {
  bitrixDepartmentId: string
  name: string
  active: boolean
}

export interface BitrixUserForReconciliation {
  bitrixUserId: string
  fullName: string
  email: string | null
  departmentIds: string[]
  active: boolean
}

export interface DepartmentReconciliation {
  legacyId: number
  bitrixDepartmentId: string | null
  status: ReconciliationStatus
  method: string | null
}

export interface PersonReconciliation {
  legacyId: number
  bitrixUserId: string | null
  status: ReconciliationStatus
  method: string | null
}

export interface InventoryReconciliationPlan {
  departments: Map<number, DepartmentReconciliation>
  people: Map<number, PersonReconciliation>
  summary: {
    departments: Record<ReconciliationStatus, number>
    people: Record<ReconciliationStatus, number>
    matchedPeopleByEmail: number
    matchedPeopleByNameAndDepartment: number
  }
}

/** Normalização conservadora: caixa, acentos e espaços; não usa fuzzy matching. */
export function normalizeIdentity(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR')
}

function groupedBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const item of items) {
    const normalized = key(item)
    if (!normalized) continue
    const values = result.get(normalized) ?? []
    values.push(item)
    result.set(normalized, values)
  }
  return result
}

function emptyStatusCounts(): Record<ReconciliationStatus, number> {
  return { MATCHED: 0, AMBIGUOUS: 0, UNMATCHED: 0 }
}

export function reconcileInventoryIdentities(
  document: InventoryExportDocument,
  bitrixDepartments: BitrixDepartmentForReconciliation[],
  bitrixUsers: BitrixUserForReconciliation[],
): InventoryReconciliationPlan {
  const targetDepartmentsByName = groupedBy(
    bitrixDepartments.filter((item) => item.active),
    (item) => normalizeIdentity(item.name),
  )
  const sourceDepartmentsByName = groupedBy(document.setores, (item) =>
    normalizeIdentity(item.nome),
  )
  const departments = new Map<number, DepartmentReconciliation>()

  for (const source of document.setores) {
    const key = normalizeIdentity(source.nome)
    const targets = targetDepartmentsByName.get(key) ?? []
    const sourceNames = sourceDepartmentsByName.get(key) ?? []
    let resolution: DepartmentReconciliation
    if (sourceNames.length === 1 && targets.length === 1) {
      resolution = {
        legacyId: source.id,
        bitrixDepartmentId: targets[0]!.bitrixDepartmentId,
        status: 'MATCHED',
        method: 'normalized_name_unique',
      }
    } else if (targets.length > 0) {
      resolution = {
        legacyId: source.id,
        bitrixDepartmentId: null,
        status: 'AMBIGUOUS',
        method: null,
      }
    } else {
      resolution = {
        legacyId: source.id,
        bitrixDepartmentId: null,
        status: 'UNMATCHED',
        method: null,
      }
    }
    departments.set(source.id, resolution)
  }

  const activeBitrixUsers = bitrixUsers.filter((item) => item.active)
  const targetUsersByEmail = groupedBy(activeBitrixUsers, (item) => normalizeIdentity(item.email))
  const targetUsersByName = groupedBy(activeBitrixUsers, (item) => normalizeIdentity(item.fullName))
  const sourcePeopleByEmail = groupedBy(document.colaboradores, (item) =>
    normalizeIdentity(item.email),
  )
  const sourcePeopleByName = groupedBy(document.colaboradores, (item) =>
    normalizeIdentity(item.nome),
  )
  const people = new Map<number, PersonReconciliation>()

  for (const source of document.colaboradores) {
    const emailKey = normalizeIdentity(source.email)
    const sourceEmailMatches = emailKey ? (sourcePeopleByEmail.get(emailKey) ?? []) : []
    const targetEmailMatches = emailKey ? (targetUsersByEmail.get(emailKey) ?? []) : []
    if (emailKey && sourceEmailMatches.length === 1 && targetEmailMatches.length === 1) {
      people.set(source.id, {
        legacyId: source.id,
        bitrixUserId: targetEmailMatches[0]!.bitrixUserId,
        status: 'MATCHED',
        method: 'email_exact_unique',
      })
      continue
    }

    const nameKey = normalizeIdentity(source.nome)
    const sourceNameMatches = sourcePeopleByName.get(nameKey) ?? []
    const targetNameMatches = targetUsersByName.get(nameKey) ?? []
    const departmentMatch =
      source.department_id === null ? null : departments.get(source.department_id)
    const uniqueTarget = targetNameMatches.length === 1 ? targetNameMatches[0]! : null
    const departmentCompatible =
      departmentMatch?.status === 'MATCHED' &&
      departmentMatch.bitrixDepartmentId !== null &&
      uniqueTarget?.departmentIds.includes(departmentMatch.bitrixDepartmentId)

    if (sourceNameMatches.length === 1 && uniqueTarget && departmentCompatible) {
      people.set(source.id, {
        legacyId: source.id,
        bitrixUserId: uniqueTarget.bitrixUserId,
        status: 'MATCHED',
        method: 'normalized_name_unique_department_confirmed',
      })
    } else if (targetNameMatches.length > 0 || targetEmailMatches.length > 0) {
      people.set(source.id, {
        legacyId: source.id,
        bitrixUserId: null,
        status: 'AMBIGUOUS',
        method: null,
      })
    } else {
      people.set(source.id, {
        legacyId: source.id,
        bitrixUserId: null,
        status: 'UNMATCHED',
        method: null,
      })
    }
  }

  // Um BitrixUser representa uma única identidade. Se dois cadastros legados
  // convergirem para o mesmo alvo por evidências diferentes, preservamos apenas
  // o casamento por e-mail (mais forte) quando ele for único; os demais ficam
  // para revisão manual. Sem um vencedor inequívoco, todos ficam ambíguos.
  const matchesByTarget = groupedBy(
    [...people.values()].filter(
      (item): item is PersonReconciliation & { bitrixUserId: string } =>
        item.status === 'MATCHED' && item.bitrixUserId !== null,
    ),
    (item) => item.bitrixUserId,
  )
  for (const matches of matchesByTarget.values()) {
    if (matches.length < 2) continue
    const emailMatches = matches.filter((item) => item.method === 'email_exact_unique')
    const winner = emailMatches.length === 1 ? emailMatches[0] : null
    for (const match of matches) {
      if (match === winner) continue
      people.set(match.legacyId, {
        legacyId: match.legacyId,
        bitrixUserId: null,
        status: 'AMBIGUOUS',
        method: null,
      })
    }
  }

  const departmentCounts = emptyStatusCounts()
  for (const item of departments.values()) departmentCounts[item.status] += 1
  const peopleCounts = emptyStatusCounts()
  for (const item of people.values()) peopleCounts[item.status] += 1
  const matchedPeopleByEmail = [...people.values()].filter(
    (item) => item.method === 'email_exact_unique',
  ).length
  const matchedPeopleByNameAndDepartment = [...people.values()].filter(
    (item) => item.method === 'normalized_name_unique_department_confirmed',
  ).length

  return {
    departments,
    people,
    summary: {
      departments: departmentCounts,
      people: peopleCounts,
      matchedPeopleByEmail,
      matchedPeopleByNameAndDepartment,
    },
  }
}

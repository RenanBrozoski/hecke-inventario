import { prisma } from '@/src/lib/prisma'

const MAX_PAGE_SIZE = 50

export interface DirectorySearchParams {
  portalId: string
  search?: string
  activeOnly?: boolean
  page?: number
  pageSize?: number
}

function normalizePagination(page?: number, pageSize?: number) {
  return {
    page: Math.max(1, page ?? 1),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize ?? 20)),
  }
}

/** Pesquisa paginada no espelho local — nunca consulta o Bitrix24 em tempo
 * real, sempre escopada por portalId (nunca vaza entre portais). */
export async function searchBitrixUsers(params: DirectorySearchParams) {
  const { page, pageSize } = normalizePagination(params.page, params.pageSize)

  const where = {
    portalId: params.portalId,
    ...(params.activeOnly !== false ? { active: true } : {}),
    ...(params.search ? { fullName: { contains: params.search, mode: 'insensitive' as const } } : {}),
  }

  const [items, total] = await Promise.all([
    prisma.bitrixUser.findMany({
      where,
      select: {
        bitrixUserId: true,
        fullName: true,
        position: true,
        email: true,
        departmentIds: true,
        active: true,
      },
      orderBy: { fullName: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.bitrixUser.count({ where }),
  ])

  return { items, total, page, pageSize }
}

export async function searchBitrixDepartments(params: DirectorySearchParams) {
  const { page, pageSize } = normalizePagination(params.page, params.pageSize)

  const where = {
    portalId: params.portalId,
    ...(params.activeOnly !== false ? { active: true } : {}),
    ...(params.search ? { name: { contains: params.search, mode: 'insensitive' as const } } : {}),
  }

  const [items, total] = await Promise.all([
    prisma.bitrixDepartment.findMany({
      where,
      select: {
        bitrixDepartmentId: true,
        name: true,
        parentBitrixDepartmentId: true,
        headBitrixUserId: true,
        active: true,
      },
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.bitrixDepartment.count({ where }),
  ])

  return { items, total, page, pageSize }
}

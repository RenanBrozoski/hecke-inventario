import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, paginateBitrixListMock } = vi.hoisted(() => ({
  prismaMock: {
    bitrixPortal: { updateMany: vi.fn(), update: vi.fn() },
    bitrixUser: { upsert: vi.fn(), updateMany: vi.fn() },
    bitrixDepartment: { upsert: vi.fn(), updateMany: vi.fn() },
  },
  paginateBitrixListMock: vi.fn(),
}))

vi.mock('@/src/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('./client', () => ({ paginateBitrixList: paginateBitrixListMock }))

import { syncPortalUsersAndDepartments } from './sync'

describe('syncPortalUsersAndDepartments (Bloco 7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.bitrixPortal.updateMany.mockResolvedValue({ count: 1 }) // reivindica a execução
    prismaMock.bitrixUser.upsert.mockResolvedValue({})
    prismaMock.bitrixDepartment.upsert.mockResolvedValue({})
    prismaMock.bitrixUser.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.bitrixDepartment.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.bitrixPortal.update.mockResolvedValue({})
  })

  it('sincronização completa: upserta tudo, inativa só depois, e marca sucesso', async () => {
    paginateBitrixListMock
      .mockResolvedValueOnce([{ ID: '1', NAME: 'Ana', ACTIVE: true, UF_DEPARTMENT: [10] }])
      .mockResolvedValueOnce([{ ID: '10', NAME: 'TI', UF_HEAD: '2' }])

    const result = await syncPortalUsersAndDepartments('portal-1')

    expect(result.usersUpserted).toBe(1)
    expect(result.departmentsUpserted).toBe(1)
    expect(prismaMock.bitrixUser.upsert).toHaveBeenCalledTimes(1)
    expect(prismaMock.bitrixDepartment.upsert).toHaveBeenCalledTimes(1)
    expect(prismaMock.bitrixPortal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ syncStatus: 'SUCCESS' }) }),
    )
  })

  it('bloqueia execução concorrente para o mesmo portal', async () => {
    prismaMock.bitrixPortal.updateMany.mockResolvedValue({ count: 0 }) // já está RUNNING

    await expect(syncPortalUsersAndDepartments('portal-1')).rejects.toThrow(/em andamento/)
    expect(paginateBitrixListMock).not.toHaveBeenCalled()
  })

  it('sincronização parcial (erro no meio da paginação) nunca inativa registros', async () => {
    paginateBitrixListMock.mockRejectedValue(new Error('falha de rede simulada'))

    await expect(syncPortalUsersAndDepartments('portal-1')).rejects.toThrow('falha de rede simulada')

    expect(prismaMock.bitrixUser.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.bitrixDepartment.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.bitrixPortal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ syncStatus: 'ERROR' }) }),
    )
  })
})

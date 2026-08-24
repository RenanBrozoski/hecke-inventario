import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, tx, recordAuditEventMock } = vi.hoisted(() => {
  const txClient = {
    $queryRaw: vi.fn().mockResolvedValue([{ lock: '' }]),
    inventoryDepartment: { findFirst: vi.fn(), delete: vi.fn() },
    inventoryLocation: { findFirst: vi.fn(), delete: vi.fn() },
  }
  return {
    tx: txClient,
    prismaMock: { $transaction: vi.fn() },
    recordAuditEventMock: vi.fn(),
  }
})

vi.mock('@/src/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/src/modules/audit/log', () => ({ recordAuditEvent: recordAuditEventMock }))

import { InventoryConflictError } from './http'
import { permanentlyDeleteDepartment, permanentlyDeleteLocation } from './service'

const context = { portalId: 'portal-1', bitrixUserId: 'admin-1', userName: 'Admin', role: 'ADMIN' as const }

describe('exclusão definitiva de setores e locais', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx))
  })

  it('remove um setor sem vínculos e registra auditoria', async () => {
    tx.inventoryDepartment.findFirst.mockResolvedValue({
      id: 'department-1',
      _count: { people: 0, equipment: 0, movementsFrom: 0, movementsTo: 0 },
    })

    await expect(permanentlyDeleteDepartment(context, 'department-1')).resolves.toEqual({
      id: 'department-1', deleted: true,
    })

    expect(tx.inventoryDepartment.delete).toHaveBeenCalledWith({ where: { id: 'department-1' } })
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inventory_department_deleted', entityId: 'department-1' }),
      tx,
    )
  })

  it('bloqueia apagar setor que possui movimentação histórica', async () => {
    tx.inventoryDepartment.findFirst.mockResolvedValue({
      id: 'department-1',
      _count: { people: 0, equipment: 0, movementsFrom: 1, movementsTo: 0 },
    })

    await expect(permanentlyDeleteDepartment(context, 'department-1')).rejects.toBeInstanceOf(InventoryConflictError)
    expect(tx.inventoryDepartment.delete).not.toHaveBeenCalled()
  })

  it('remove local sem equipamento e bloqueia local vinculado', async () => {
    tx.inventoryLocation.findFirst.mockResolvedValueOnce({ id: 'location-1', _count: { equipment: 0 } })
    await expect(permanentlyDeleteLocation(context, 'location-1')).resolves.toEqual({ id: 'location-1', deleted: true })
    expect(tx.inventoryLocation.delete).toHaveBeenCalledWith({ where: { id: 'location-1' } })

    tx.inventoryLocation.findFirst.mockResolvedValueOnce({ id: 'location-2', _count: { equipment: 1 } })
    await expect(permanentlyDeleteLocation(context, 'location-2')).rejects.toBeInstanceOf(InventoryConflictError)
  })
})

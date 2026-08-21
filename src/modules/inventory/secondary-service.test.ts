import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, tx, recordAuditEventMock } = vi.hoisted(() => {
  const transactionClient = {
    $queryRaw: vi.fn(),
    inventoryPerson: { findFirst: vi.fn() },
    inventoryEquipment: { findMany: vi.fn() },
    inventoryTerm: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  }
  return {
    tx: transactionClient,
    prismaMock: { $transaction: vi.fn() },
    recordAuditEventMock: vi.fn(),
  }
})

vi.mock('@/src/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/src/modules/audit/log', () => ({ recordAuditEvent: recordAuditEventMock }))

import { InventoryConflictError, InventoryValidationError } from './http'
import { createTerm } from './secondary-service'

const context = {
  portalId: 'portal-1',
  bitrixUserId: 'user-1',
  userName: 'Operador',
  role: 'OPERATOR' as const,
}

describe('createTerm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    )
    tx.inventoryPerson.findFirst.mockResolvedValue({
      id: 'person-1',
      name: 'Pessoa real',
      department: { name: 'TI' },
    })
    tx.inventoryEquipment.findMany.mockResolvedValue([
      {
        id: 'eq-1',
        revision: 3,
        patrimony: 'NOTE-001',
        assetTag: '100',
        name: 'Notebook real',
        serialNumber: 'SERIE-1',
        specs: { modelo: 'X1', senha: 'nunca-exportar' },
        category: {
          name: 'Notebook',
          fields: [
            {
              key: 'modelo',
              label: 'Modelo',
              type: 'TEXT',
              active: true,
              listVisible: true,
            },
            {
              key: 'senha',
              label: 'Senha',
              type: 'PASSWORD',
              active: true,
              listVisible: true,
            },
          ],
        },
      },
    ])
    tx.inventoryTerm.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'term-1',
        ...data,
      }),
    )
  })

  it('monta snapshot no servidor a partir da posse atual e redige PASSWORD', async () => {
    await createTerm(context, {
      type: 'RESPONSIBILITY',
      personId: 'person-1',
      equipmentIds: ['eq-1'],
      expectedRevisions: { 'eq-1': 3 },
      observations: null,
    })

    expect(tx.inventoryEquipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          portalId: 'portal-1',
          currentHolderId: 'person-1',
          id: { in: ['eq-1'] },
        }),
      }),
    )
    const create = tx.inventoryTerm.create.mock.calls[0]?.[0] as {
      data: {
        items: Array<{
          name: string
          visibleSpecs: Array<{ key: string; label: string; value: unknown }>
        }>
      }
    }
    expect(create.data.items).toEqual([
      expect.objectContaining({
        name: 'Notebook real',
        visibleSpecs: [{ key: 'modelo', label: 'Modelo', value: 'X1' }],
      }),
    ])
    expect(JSON.stringify(create.data.items)).not.toContain('nunca-exportar')
    expect(recordAuditEventMock).toHaveBeenCalledOnce()
  })

  it('rejeita item que não pertence mais à pessoa', async () => {
    tx.inventoryEquipment.findMany.mockResolvedValue([])
    await expect(
      createTerm(context, {
        type: 'RETURN',
        personId: 'person-1',
        equipmentIds: ['eq-1'],
        expectedRevisions: { 'eq-1': 3 },
      }),
    ).rejects.toBeInstanceOf(InventoryValidationError)
    expect(tx.inventoryTerm.create).not.toHaveBeenCalled()
  })

  it('rejeita revisão obsoleta depois de adquirir o lock dos equipamentos', async () => {
    await expect(
      createTerm(context, {
        type: 'DELIVERY',
        personId: 'person-1',
        equipmentIds: ['eq-1'],
        expectedRevisions: { 'eq-1': 2 },
      }),
    ).rejects.toBeInstanceOf(InventoryConflictError)
    expect(tx.$queryRaw).toHaveBeenCalledOnce()
    expect(tx.inventoryTerm.create).not.toHaveBeenCalled()
  })
})

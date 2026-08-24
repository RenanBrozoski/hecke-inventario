import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, tx, auditMock } = vi.hoisted(() => {
  const transaction = {
    inventoryPerson: { findFirst: vi.fn() },
    inventoryEquipment: { findFirst: vi.fn() },
    inventoryCorporateLine: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    inventoryCorporateLineHistory: { create: vi.fn() },
  }
  return {
    tx: transaction,
    prismaMock: { $transaction: vi.fn() },
    auditMock: vi.fn(),
  }
})

vi.mock('@/src/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/src/modules/audit/log', () => ({ recordAuditEvent: auditMock }))

import { InventoryConflictError } from './http'
import {
  createCorporateLine,
  normalizeCorporateLineNumber,
  updateCorporateLine,
} from './corporate-line-service'

const context = {
  portalId: 'portal-1',
  bitrixUserId: 'user-1',
  userName: 'Operador',
  role: 'OPERATOR' as const,
}

const holder = { id: 'person-1', name: 'Pessoa' }
const equipment = { id: 'eq-1', patrimony: 'SM-1', assetTag: null, name: 'Smartphone' }

function line(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    portalId: 'portal-1',
    number: '(11) 99999-0000',
    normalizedNumber: '5511999990000',
    carrier: 'Operadora',
    plan: 'Plano 20GB',
    dataAllowance: '20 GB',
    status: 'ACTIVE',
    currentHolderId: 'person-1',
    equipmentId: 'eq-1',
    simSlot: 'eSIM',
    revision: 1,
    archivedAt: null,
    currentHolder: holder,
    equipment: { ...equipment, category: { name: 'Smartphone' } },
    ...overrides,
  }
}

describe('linhas corporativas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    )
    tx.inventoryPerson.findFirst.mockResolvedValue(holder)
    tx.inventoryEquipment.findFirst.mockResolvedValue(equipment)
  })

  it('normaliza telefone nacional e rejeita números sem tamanho válido', () => {
    expect(normalizeCorporateLineNumber('(11) 99999-0000')).toBe('5511999990000')
    expect(normalizeCorporateLineNumber('+1 212 555 0100')).toBe('12125550100')
    expect(() => normalizeCorporateLineNumber('123')).toThrow(/telefônico válido/)
  })

  it('cria uma linha com vínculo opcional, histórico e auditoria', async () => {
    tx.inventoryCorporateLine.create.mockResolvedValue(line())

    await createCorporateLine(context, {
      number: '(11) 99999-0000',
      carrier: 'Operadora',
      plan: 'Plano 20GB',
      dataAllowance: '20 GB',
      status: 'ACTIVE',
      currentHolderId: 'person-1',
      equipmentId: 'eq-1',
      simSlot: 'eSIM',
      activatedAt: null,
      suspendedAt: null,
      cancelledAt: null,
      notes: null,
    })

    expect(tx.inventoryCorporateLine.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          portalId: 'portal-1',
          normalizedNumber: '5511999990000',
          currentHolderId: 'person-1',
          equipmentId: 'eq-1',
        }),
      }),
    )
    expect(tx.inventoryCorporateLineHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'CREATED' }) }),
    )
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inventory_corporate_line_created', portalId: 'portal-1' }),
      tx,
    )
  })

  it('troca vínculo com CAS e registra evento de vínculo', async () => {
    tx.inventoryCorporateLine.findFirst.mockResolvedValue(line())
    tx.inventoryPerson.findFirst.mockResolvedValue({ id: 'person-2', name: 'Outra Pessoa' })
    tx.inventoryEquipment.findFirst.mockResolvedValue({ id: 'eq-2', patrimony: 'SM-2', assetTag: null, name: 'Outro Smartphone' })
    tx.inventoryCorporateLine.updateMany.mockResolvedValue({ count: 1 })
    tx.inventoryCorporateLine.findUniqueOrThrow.mockResolvedValue(
      line({
        revision: 2,
        currentHolderId: 'person-2',
        equipmentId: 'eq-2',
        currentHolder: { id: 'person-2', name: 'Outra Pessoa' },
        equipment: { id: 'eq-2', patrimony: 'SM-2', assetTag: null, name: 'Outro Smartphone', category: { name: 'Smartphone' } },
      }),
    )

    await updateCorporateLine(context, 'line-1', {
      revision: 1,
      currentHolderId: 'person-2',
      equipmentId: 'eq-2',
    })

    expect(tx.inventoryCorporateLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ revision: 1, portalId: 'portal-1' }) }),
    )
    expect(tx.inventoryCorporateLineHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'LINK_UPDATED' }) }),
    )
  })

  it('não sobrescreve uma linha alterada por outra pessoa', async () => {
    tx.inventoryCorporateLine.findFirst.mockResolvedValue(line())
    tx.inventoryCorporateLine.updateMany.mockResolvedValue({ count: 0 })
    await expect(updateCorporateLine(context, 'line-1', { revision: 1, plan: 'Novo plano' })).rejects.toBeInstanceOf(
      InventoryConflictError,
    )
    expect(tx.inventoryCorporateLineHistory.create).not.toHaveBeenCalled()
  })
})

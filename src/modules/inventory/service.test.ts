import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, tx, recordAuditEventMock } = vi.hoisted(() => {
  const txClient = {
    $queryRaw: vi.fn().mockResolvedValue([{ lock: '' }]),
    inventoryEquipment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    inventoryPerson: { findFirst: vi.fn() },
    inventoryDepartment: { findFirst: vi.fn() },
    inventoryLocation: { findFirst: vi.fn() },
    inventoryMovement: { create: vi.fn() },
    inventoryTerm: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  }
  return {
    tx: txClient,
    prismaMock: {
      $transaction: vi.fn(),
      inventoryCategory: { findFirst: vi.fn() },
      inventoryEquipment: { findMany: vi.fn() },
    },
    recordAuditEventMock: vi.fn(),
  }
})

vi.mock('@/src/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/src/modules/audit/log', () => ({ recordAuditEvent: recordAuditEventMock }))

import { InventoryConflictError } from './http'
import {
  bulkTransferEquipment,
  redactPasswordValues,
  getEquipmentCodeSuggestion,
  transferEquipment,
  validateDynamicData,
  type DynamicField,
} from './service'

const context = {
  portalId: 'portal-1',
  bitrixUserId: 'user-1',
  userName: 'Operador',
  role: 'OPERATOR' as const,
}

function equipment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'eq-1',
    portalId: 'portal-1',
    revision: 4,
    currentHolderId: 'person-old',
    departmentId: 'dep-old',
    locationId: 'loc-old',
    status: 'ACTIVE',
    specs: { hostname: 'pc-01', password: 'segredo' },
    category: {
      id: 'cat-1',
      name: 'Notebook',
      fields: [
        {
          key: 'hostname',
          label: 'Hostname',
          type: 'TEXT',
          options: [],
          required: false,
          active: true,
        },
        {
          key: 'password',
          label: 'Senha',
          type: 'PASSWORD',
          options: [],
          required: false,
          active: true,
        },
      ],
    },
    currentHolder: { id: 'person-old', name: 'Pessoa Antiga', status: 'ACTIVE' },
    department: { id: 'dep-old', name: 'Setor Antigo' },
    location: { id: 'loc-old', name: 'Sala 1' },
    ...overrides,
  }
}

describe('segurança de campos dinâmicos', () => {
  it('rejeita persistência de PASSWORD e redige segredo legado', () => {
    const fields = equipment().category.fields as DynamicField[]
    expect(() => validateDynamicData({ hostname: 'pc', password: '123' }, fields)).toThrow(
      /inválidos/,
    )
    expect(redactPasswordValues({ hostname: 'pc', password: '123' }, fields)).toEqual({
      hostname: 'pc',
    })
  })
})

describe('sugestão de código interno', () => {
  it('apresenta o último código da categoria e sugere o próximo', async () => {
    prismaMock.inventoryCategory.findFirst.mockResolvedValue({ prefix: 'MN' })
    prismaMock.inventoryEquipment.findMany.mockResolvedValue([
      { patrimony: 'MN009' }, { patrimony: 'MN104' }, { patrimony: 'TAG-999' },
    ])
    await expect(getEquipmentCodeSuggestion('portal-1', 'cat-monitor')).resolves.toEqual({
      prefix: 'MN', lastCode: 'MN104', suggestedCode: 'MN105',
    })
  })
})

describe('transferEquipment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    )
  })

  it('escopa a leitura pelo portal e converte corrida de revision em 409', async () => {
    tx.inventoryEquipment.findFirst.mockResolvedValue(equipment())
    tx.inventoryLocation.findFirst.mockResolvedValue({ id: 'loc-new', portalId: 'portal-1' })
    tx.inventoryEquipment.updateMany.mockResolvedValue({ count: 0 })

    await expect(
      transferEquipment(context, 'eq-1', {
        revision: 4,
        locationId: 'loc-new',
        origin: 'MANUAL',
      }),
    ).rejects.toBeInstanceOf(InventoryConflictError)

    expect(tx.inventoryEquipment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'eq-1', portalId: 'portal-1' }),
      }),
    )
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled()
    expect(recordAuditEventMock).not.toHaveBeenCalled()
  })

  it('atualiza local/status e audita sem criar movimento de posse', async () => {
    const current = equipment()
    const after = equipment({ revision: 5, locationId: 'loc-new', status: 'MAINTENANCE' })
    tx.inventoryEquipment.findFirst.mockResolvedValue(current)
    tx.inventoryLocation.findFirst.mockResolvedValue({ id: 'loc-new', portalId: 'portal-1' })
    tx.inventoryEquipment.updateMany.mockResolvedValue({ count: 1 })
    tx.inventoryEquipment.findUniqueOrThrow.mockResolvedValue(after)

    const result = await transferEquipment(context, 'eq-1', {
      revision: 4,
      locationId: 'loc-new',
      status: 'MAINTENANCE',
      origin: 'MANUAL',
    })

    expect(result.movement).toBeNull()
    expect(result.equipment.specs).toEqual({ hostname: 'pc-01' })
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled()
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inventory_equipment_transferred', portalId: 'portal-1' }),
      tx,
    )
  })

  it('cria exatamente um movimento append-only quando posse/setor mudam', async () => {
    const after = equipment({
      revision: 5,
      currentHolderId: 'person-new',
      departmentId: 'dep-new',
      currentHolder: { id: 'person-new', name: 'Pessoa Nova', status: 'ACTIVE' },
      department: { id: 'dep-new', name: 'Setor Novo' },
    })
    tx.inventoryEquipment.findFirst.mockResolvedValue(equipment())
    tx.inventoryPerson.findFirst.mockResolvedValue({
      id: 'person-new',
      name: 'Pessoa Nova',
      departmentId: 'dep-new',
    })
    tx.inventoryDepartment.findFirst.mockResolvedValue({ id: 'dep-new', name: 'Setor Novo' })
    tx.inventoryEquipment.updateMany.mockResolvedValue({ count: 1 })
    tx.inventoryMovement.create.mockResolvedValue({ id: 'movement-1' })
    tx.inventoryEquipment.findUniqueOrThrow.mockResolvedValue(after)

    const result = await transferEquipment(context, 'eq-1', {
      revision: 4,
      toPersonId: 'person-new',
      toDepartmentId: 'dep-new',
      movedAt: '2026-08-20',
      reason: 'Troca de responsável',
      origin: 'MANUAL',
    })

    expect(result.movement).toEqual({ id: 'movement-1' })
    expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(1)
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        portalId: 'portal-1',
        fromPersonId: 'person-old',
        fromPersonName: 'Pessoa Antiga',
        toPersonId: 'person-new',
        toPersonName: 'Pessoa Nova',
        performedByBitrixUserId: 'user-1',
      }),
    })
  })
})

describe('bulkTransferEquipment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    )
  })

  it('faz CAS de todo o lote, herda o setor do destino e cria movimentos/termo/auditoria', async () => {
    tx.inventoryPerson.findFirst
      .mockResolvedValueOnce({
        id: 'person-source',
        name: 'Pessoa Origem',
        departmentId: 'dep-source',
        department: { id: 'dep-source', name: 'Setor Origem' },
      })
      .mockResolvedValueOnce({
        id: 'person-destination',
        name: 'Pessoa Destino',
        departmentId: 'dep-destination',
        department: { id: 'dep-destination', name: 'Setor Destino' },
      })
    tx.inventoryEquipment.findMany.mockResolvedValue([
      equipment({
        id: 'eq-1',
        currentHolderId: 'person-source',
        revision: 4,
        patrimony: 'PAT-1',
        specs: { password: 'nunca-copiar' },
      }),
      equipment({
        id: 'eq-2',
        currentHolderId: 'person-source',
        revision: 8,
        patrimony: 'PAT-2',
        specs: { password: 'nunca-copiar' },
      }),
    ])
    tx.inventoryEquipment.updateMany.mockResolvedValue({ count: 1 })
    tx.inventoryMovement.create
      .mockResolvedValueOnce({ id: 'movement-1' })
      .mockResolvedValueOnce({ id: 'movement-2' })
    tx.inventoryTerm.create.mockResolvedValue({ id: 'term-1' })

    const result = await bulkTransferEquipment(context, 'person-source', {
      equipmentIds: ['eq-1', 'eq-2'],
      expectedRevisions: { 'eq-1': 4, 'eq-2': 8 },
      destinationPersonId: 'person-destination',
      movedAt: '2026-08-20',
      reason: 'Troca de equipe',
      createTerm: true,
    })

    expect(result).toMatchObject({ transferredCount: 2, term: { id: 'term-1' } })
    expect(tx.inventoryEquipment.updateMany).toHaveBeenCalledTimes(2)
    for (const call of tx.inventoryEquipment.updateMany.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({
            currentHolderId: 'person-destination',
            departmentId: 'dep-destination',
          }),
        }),
      )
    }
    expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(2)
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        origin: 'BULK_TRANSFER',
        fromPersonId: 'person-source',
        toPersonId: 'person-destination',
        toDepartmentId: 'dep-destination',
        performedByBitrixUserId: 'user-1',
      }),
    })
    const termData = tx.inventoryTerm.create.mock.calls[0]?.[0]?.data
    expect(termData).toEqual(
      expect.objectContaining({
        type: 'TRANSFER',
        personName: 'Pessoa Origem',
        destinationPersonName: 'Pessoa Destino',
      }),
    )
    expect(JSON.stringify(termData)).not.toContain('nunca-copiar')
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inventory_bulk_transfer_completed',
        metadata: expect.objectContaining({ transferredCount: 2, termId: 'term-1' }),
      }),
      tx,
    )
  })

  it('preserva o setor legado ao transferir para estoque', async () => {
    tx.inventoryPerson.findFirst.mockResolvedValue({
      id: 'person-source',
      name: 'Pessoa Origem',
      departmentId: 'dep-source',
      department: { id: 'dep-source', name: 'Setor Origem' },
    })
    tx.inventoryEquipment.findMany.mockResolvedValue([
      equipment({ id: 'eq-1', currentHolderId: 'person-source', revision: 4 }),
    ])
    tx.inventoryEquipment.updateMany.mockResolvedValue({ count: 1 })
    tx.inventoryMovement.create.mockResolvedValue({ id: 'movement-1' })

    await bulkTransferEquipment(context, 'person-source', {
      equipmentIds: ['eq-1'],
      expectedRevisions: { 'eq-1': 4 },
      destinationPersonId: null,
      movedAt: '2026-08-20',
      reason: null,
      createTerm: false,
    })

    const updateData = tx.inventoryEquipment.updateMany.mock.calls[0]?.[0]?.data
    expect(updateData).toEqual(
      expect.objectContaining({ currentHolderId: null, revision: { increment: 1 } }),
    )
    expect(updateData).not.toHaveProperty('departmentId')
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        toPersonId: null,
        toDepartmentId: 'dep-old',
        toDepartmentName: 'Setor Antigo',
      }),
    })
    expect(tx.inventoryTerm.create).not.toHaveBeenCalled()
  })

  it('aborta antes dos eventos quando qualquer CAS perde a corrida', async () => {
    tx.inventoryPerson.findFirst
      .mockResolvedValueOnce({
        id: 'person-source',
        name: 'Pessoa Origem',
        department: null,
      })
      .mockResolvedValueOnce({
        id: 'person-destination',
        name: 'Pessoa Destino',
        departmentId: null,
        department: null,
      })
    tx.inventoryEquipment.findMany.mockResolvedValue([
      equipment({ id: 'eq-1', currentHolderId: 'person-source', revision: 4 }),
      equipment({ id: 'eq-2', currentHolderId: 'person-source', revision: 8 }),
    ])
    tx.inventoryEquipment.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    await expect(
      bulkTransferEquipment(context, 'person-source', {
        equipmentIds: ['eq-1', 'eq-2'],
        expectedRevisions: { 'eq-1': 4, 'eq-2': 8 },
        destinationPersonId: 'person-destination',
        movedAt: '2026-08-20',
        reason: null,
        createTerm: true,
      }),
    ).rejects.toBeInstanceOf(InventoryConflictError)

    expect(tx.inventoryMovement.create).not.toHaveBeenCalled()
    expect(tx.inventoryTerm.create).not.toHaveBeenCalled()
    expect(recordAuditEventMock).not.toHaveBeenCalled()
  })

  it('não revela nem altera IDs fora da posse/portal da origem', async () => {
    tx.inventoryPerson.findFirst.mockResolvedValue({
      id: 'person-source',
      name: 'Pessoa Origem',
      department: null,
    })
    tx.inventoryEquipment.findMany.mockResolvedValue([
      equipment({ id: 'eq-1', currentHolderId: 'person-source', revision: 4 }),
    ])

    await expect(
      bulkTransferEquipment(context, 'person-source', {
        equipmentIds: ['eq-1', 'eq-outro-portal'],
        expectedRevisions: { 'eq-1': 4, 'eq-outro-portal': 1 },
        destinationPersonId: null,
        movedAt: '2026-08-20',
        reason: null,
        createTerm: false,
      }),
    ).rejects.toBeInstanceOf(InventoryConflictError)

    expect(tx.inventoryEquipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          portalId: 'portal-1',
          currentHolderId: 'person-source',
          id: { in: ['eq-1', 'eq-outro-portal'] },
        }),
      }),
    )
    expect(tx.inventoryEquipment.updateMany).not.toHaveBeenCalled()
  })
})

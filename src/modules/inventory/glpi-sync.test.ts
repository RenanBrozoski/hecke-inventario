import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, tx } = vi.hoisted(() => {
  const txClient = {
    inventoryEquipment: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  }
  return {
    tx: txClient,
    prismaMock: {
      bitrixPortal: { findUnique: vi.fn() },
      inventoryCategory: { findFirst: vi.fn() },
      $transaction: vi.fn(),
    },
  }
})

vi.mock('@/src/lib/prisma', () => ({ prisma: prismaMock }))

import { syncGlpiComputers } from './glpi-sync'

const payload = {
  portalDomain: 'empresa.bitrix24.com.br',
  categoryName: 'Desktop',
  items: [{
    id: 10,
    name: 'PC010',
    serialNumber: 'SERIAL-10',
    glpiOtherSerial: 'GLPI-OTHER-10',
    memory: '16 GB',
    memoryModules: 2,
    macCable: '00:11:22:33:44:55',
    macWifi: '66:77:88:99:AA:BB',
    videoCard: 'NVIDIA RTX',
  }],
}

describe('syncGlpiComputers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.bitrixPortal.findUnique.mockResolvedValue({ id: 'portal-1' })
    prismaMock.inventoryCategory.findFirst.mockResolvedValue({ id: 'category-1' })
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx))
  })

  it('preserva TAG patrimonial manual e especificações não retornadas pelo GLPI', async () => {
    tx.inventoryEquipment.findUnique.mockResolvedValue({
      id: 'equipment-1',
      assetTag: 'TAG-MANUAL-1',
      specs: { antivirus: 'McAfee', ip: '192.168.1.10', credencial_rede: 'não alterar' },
    })

    await expect(syncGlpiComputers(payload)).resolves.toEqual({ created: 0, updated: 1, total: 1 })

    const update = tx.inventoryEquipment.update.mock.calls[0]?.[0]?.data
    expect(update.assetTag).toBeUndefined()
    expect(update.specs).toMatchObject({
      antivirus: 'McAfee',
      ip: '192.168.1.10',
      credencial_rede: 'não alterar',
      ram: '16 GB',
      ram_pentes: 2,
      mac_cabo: '00:11:22:33:44:55',
      mac_wifi: '66:77:88:99:AA:BB',
      placa_video: 'NVIDIA RTX',
      glpi: { otherSerial: 'GLPI-OTHER-10' },
    })
  })

  it('não usa o outro número do GLPI como TAG patrimonial ao criar equipamento', async () => {
    tx.inventoryEquipment.findUnique.mockResolvedValue(null)
    tx.inventoryEquipment.create.mockResolvedValue({ id: 'equipment-1' })

    await expect(syncGlpiComputers(payload)).resolves.toEqual({ created: 1, updated: 0, total: 1 })

    const data = tx.inventoryEquipment.create.mock.calls[0]?.[0]?.data
    expect(data).not.toHaveProperty('assetTag')
    expect(data.specs).toMatchObject({ ram: '16 GB', ram_pentes: 2, glpi: { otherSerial: 'GLPI-OTHER-10' } })
  })
})

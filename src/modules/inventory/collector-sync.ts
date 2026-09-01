import { InventoryEquipmentStatus } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/src/lib/prisma'
import { InventoryNotFoundError, InventoryValidationError } from './http'

const collectorMachineSchema = z.object({
  name: z.string().trim().min(1).max(200),
  serialNumber: z.string().trim().max(200).nullable().optional(),
  manufacturer: z.string().trim().max(200).nullable().optional(),
  model: z.string().trim().max(200).nullable().optional(),
  operatingSystem: z.string().trim().max(300).nullable().optional(),
  processor: z.string().trim().max(300).nullable().optional(),
  videoCard: z.string().trim().max(300).nullable().optional(),
  memory: z.string().trim().max(100).nullable().optional(),
  memoryModules: z.number().int().min(0).max(64).nullable().optional(),
  storage: z.string().trim().max(300).nullable().optional(),
  macCable: z.string().trim().max(50).nullable().optional(),
  macWifi: z.string().trim().max(50).nullable().optional(),
  ipAddress: z.string().trim().max(100).nullable().optional(),
  anydeskCode: z.string().trim().max(50).nullable().optional(),
})

export const collectorSyncPayloadSchema = z.object({
  portalDomain: z.string().trim().min(3).max(255).toLowerCase(),
  categoryName: z.string().trim().min(1).max(120),
  machine: collectorMachineSchema,
})

export type CollectorSyncPayload = z.infer<typeof collectorSyncPayloadSchema>

function nullable(value: string | null | undefined): string | null {
  return value?.trim() || null
}

/** Normaliza MAC para XX:XX:XX:XX:XX:XX maiúsculo.
 * Aceita qualquer separador (traço, dois-pontos, ponto, sem separador). */
function normalizeMac(mac: string | null | undefined): string | null {
  if (!mac) return null
  const digits = mac.replace(/[^0-9a-fA-F]/g, '')
  if (digits.length !== 12) return null
  return digits.match(/.{2}/g)!.join(':').toUpperCase()
}

function presentSpecs(specs: Record<string, string | number | null>) {
  return Object.fromEntries(Object.entries(specs).filter(([, v]) => v !== null))
}

type EquipmentRow = { id: string; specs: unknown }

/** Deduplicação em cascata: serial → MAC único → hostname+categoria único.
 * Se o match por MAC ou hostname retornar mais de um resultado, devolve conflito
 * em vez de sobrescrever ou criar equipamento errado. */
async function findExistingEquipment(
  portalId: string,
  categoryId: string,
  machine: z.infer<typeof collectorMachineSchema>,
): Promise<{ equipment: EquipmentRow | null; method: string; conflict: boolean }> {
  const serial = nullable(machine.serialNumber)

  // 1. Número de série — identificador mais confiável
  if (serial) {
    const bySerial = await prisma.inventoryEquipment.findFirst({
      where: { portalId, serialNumber: serial, archivedAt: null },
      select: { id: true, specs: true },
    })
    if (bySerial) return { equipment: bySerial, method: 'serial', conflict: false }
  }

  // 2. MAC address — apenas matches únicos (ambiguidade = conflito)
  // Tenta o formato normalizado (XX:XX:XX:XX:XX:XX) e o formato com traço (XX-XX-XX-XX-XX-XX),
  // pois imports legados gravaram MACs com traço enquanto o agente envia com dois-pontos.
  const macFilters: Array<{ specs: { path: string[]; equals: string } }> = []
  const macNorm = normalizeMac(machine.macCable)
  const macDash = macNorm ? macNorm.replace(/:/g, '-') : null
  const wifiNorm = normalizeMac(machine.macWifi)
  const wifiDash = wifiNorm ? wifiNorm.replace(/:/g, '-') : null
  if (macNorm) {
    macFilters.push({ specs: { path: ['mac_cabo'], equals: macNorm } })
    if (macDash !== macNorm) macFilters.push({ specs: { path: ['mac_cabo'], equals: macDash! } })
  }
  if (wifiNorm) {
    macFilters.push({ specs: { path: ['mac_wifi'], equals: wifiNorm } })
    if (wifiDash !== wifiNorm) macFilters.push({ specs: { path: ['mac_wifi'], equals: wifiDash! } })
  }

  if (macFilters.length > 0) {
    const byMac = await prisma.inventoryEquipment.findMany({
      where: { portalId, archivedAt: null, OR: macFilters },
      select: { id: true, specs: true },
    })
    const uniqueById = [...new Map(byMac.map((e) => [e.id, e])).values()]
    if (uniqueById.length === 1) return { equipment: uniqueById[0]!, method: 'mac', conflict: false }
    if (uniqueById.length > 1) return { equipment: null, method: 'mac', conflict: true }
  }

  // 3. Hostname + categoria — apenas match único
  const byName = await prisma.inventoryEquipment.findMany({
    where: { portalId, categoryId, name: machine.name, archivedAt: null },
    select: { id: true, specs: true },
  })
  if (byName.length === 1) return { equipment: byName[0]!, method: 'name', conflict: false }
  if (byName.length > 1) return { equipment: null, method: 'name', conflict: true }

  return { equipment: null, method: 'none', conflict: false }
}

/** Importa apenas fatos técnicos do agente local.
 * Situação, responsável, local e patrimônio continuam pertencendo ao inventário.
 * Precedência por campo: collector é autoritativo para ip, mac, anydesk e leituras
 * de hardware/OS; campos de software vindos do GLPI (antivírus, etc.) são preservados. */
export async function syncCollectorMachine(payload: CollectorSyncPayload) {
  const portal = await prisma.bitrixPortal.findUnique({
    where: { domain: payload.portalDomain },
    select: { id: true },
  })
  if (!portal) throw new InventoryNotFoundError('Portal Bitrix não encontrado.')

  const category = await prisma.inventoryCategory.findFirst({
    where: { portalId: portal.id, name: payload.categoryName, active: true },
    select: { id: true },
  })
  if (!category) {
    throw new InventoryValidationError(
      `A categoria "${payload.categoryName}" não existe ou está inativa neste inventário.`,
    )
  }

  const { machine } = payload
  const serial = nullable(machine.serialNumber)
  const motherboard = [nullable(machine.manufacturer), nullable(machine.model)]
    .filter(Boolean)
    .join(' ') || null

  const { equipment: existing, method, conflict } = await findExistingEquipment(
    portal.id,
    category.id,
    machine,
  )

  if (conflict) {
    // Ambiguidade: não criar nem sobrescrever — reporta para revisão manual
    return { created: 0, updated: 0, conflict: true, conflictMethod: method }
  }

  const collectorMeta = { syncedAt: new Date().toISOString(), source: 'collector', matchedBy: method }

  // Collector é autoritativo para hardware e rede; não inclui campos de software
  // (antivírus, lista de apps) que são domínio do GLPI — esses são preservados
  // pelo spread de prevSpecs abaixo.
  const collectorFields = presentSpecs({
    windows: nullable(machine.operatingSystem),
    processador: nullable(machine.processor),
    placa_video: nullable(machine.videoCard),
    ram: nullable(machine.memory),
    ram_pentes: machine.memoryModules ?? null,
    armazenamento: nullable(machine.storage),
    mac_cabo: normalizeMac(machine.macCable),
    mac_wifi: normalizeMac(machine.macWifi),
    ip: nullable(machine.ipAddress),
    placa_mae: motherboard,
    anydesk_id: nullable(machine.anydeskCode),
  })

  if (existing) {
    const prevSpecs =
      typeof existing.specs === 'object' && existing.specs && !Array.isArray(existing.specs)
        ? (existing.specs as Record<string, unknown>)
        : {}
    await prisma.inventoryEquipment.update({
      where: { id: existing.id },
      data: {
        name: machine.name,
        ...(serial ? { serialNumber: serial } : {}),
        // Collector sobrescreve seus próprios campos mas preserva o que veio do GLPI
        specs: { ...prevSpecs, ...collectorFields, collector: collectorMeta },
        revision: { increment: 1 },
      },
    })
    return { created: 0, updated: 1, conflict: false, matchedBy: method }
  }

  await prisma.$transaction(async (tx) => {
    const equipment = await tx.inventoryEquipment.create({
      data: {
        portalId: portal.id,
        categoryId: category.id,
        name: machine.name,
        serialNumber: serial ?? undefined,
        status: InventoryEquipmentStatus.ACTIVE,
        specs: { ...collectorFields, collector: collectorMeta },
      },
    })
    await tx.auditLog.create({
      data: {
        portalId: portal.id,
        bitrixUserId: 'COLLECTOR_SYNC',
        action: 'COLLECTOR_IMPORTED',
        entityType: 'InventoryEquipment',
        entityId: equipment.id,
        metadata: { hostname: machine.name, serialNumber: serial },
      },
    })
  })

  return { created: 1, updated: 0, conflict: false, matchedBy: 'none' }
}

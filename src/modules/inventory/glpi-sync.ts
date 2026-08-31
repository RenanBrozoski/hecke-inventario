import { InventoryEquipmentStatus } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/src/lib/prisma'
import { InventoryNotFoundError, InventoryValidationError } from './http'

const glpiItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  serialNumber: z.string().trim().max(200).nullable().optional(),
  glpiOtherSerial: z.string().trim().max(100).nullable().optional(),
  // Compatibilidade com o lançador anterior. Nunca é gravada como TAG patrimonial.
  assetTag: z.string().trim().max(100).nullable().optional(),
  manufacturer: z.string().trim().max(200).nullable().optional(),
  model: z.string().trim().max(200).nullable().optional(),
  operatingSystem: z.string().trim().max(300).nullable().optional(),
  motherboard: z.string().trim().max(300).nullable().optional(),
  processor: z.string().trim().max(300).nullable().optional(),
  videoCard: z.string().trim().max(300).nullable().optional(),
  memory: z.string().trim().max(300).nullable().optional(),
  memoryModules: z.number().int().min(0).max(64).nullable().optional(),
  storage: z.string().trim().max(300).nullable().optional(),
  macCable: z.string().trim().max(50).nullable().optional(),
  macWifi: z.string().trim().max(50).nullable().optional(),
  ipAddress: z.string().trim().max(100).nullable().optional(),
  antivirus: z.string().trim().max(300).nullable().optional(),
  anydeskCode: z.string().trim().max(100).nullable().optional(),
  ccleanerInstalled: z.boolean().nullable().optional(),
})

export const glpiSyncPayloadSchema = z.object({
  portalDomain: z.string().trim().min(3).max(255).toLowerCase(),
  categoryName: z.string().trim().min(1).max(120),
  items: z.array(glpiItemSchema).min(1).max(100),
})

export type GlpiSyncPayload = z.infer<typeof glpiSyncPayloadSchema>

function nullable(value: string | null | undefined): string | null {
  return value?.trim() || null
}

function presentSpecs(specs: Record<string, string | number | boolean | null>) {
  return Object.fromEntries(Object.entries(specs).filter(([, value]) => value !== null))
}

/** Importa somente fatos técnicos descobertos pelo GLPI. Situação, responsável,
 * local e patrimônio continuam pertencendo ao inventário e nunca são alterados
 * automaticamente por essa integração. */
export async function syncGlpiComputers(payload: GlpiSyncPayload) {
  const portal = await prisma.bitrixPortal.findUnique({
    where: { domain: payload.portalDomain },
    select: { id: true },
  })
  if (!portal) throw new InventoryNotFoundError('Portal Bitrix não encontrado para esta sincronização.')

  const category = await prisma.inventoryCategory.findFirst({
    where: { portalId: portal.id, name: payload.categoryName, active: true },
    select: { id: true },
  })
  if (!category) {
    throw new InventoryValidationError(
      `A categoria "${payload.categoryName}" não existe ou está inativa neste inventário.`,
    )
  }

  let created = 0
  let updated = 0
  await prisma.$transaction(async (tx) => {
    for (const item of payload.items) {
      const existing = await tx.inventoryEquipment.findUnique({
        where: {
          portalId_legacySource_legacyId: {
            portalId: portal.id,
            legacySource: 'glpi',
            legacyId: item.id,
          },
        },
        select: { id: true, specs: true, assetTag: true },
      })
      const otherSerial = nullable(item.glpiOtherSerial ?? item.assetTag)
      const glpiSpecs = {
        id: item.id,
        otherSerial,
        manufacturer: nullable(item.manufacturer),
        model: nullable(item.model),
        operatingSystem: nullable(item.operatingSystem),
        syncedAt: new Date().toISOString(),
      }
      // O GLPI é fonte das especificações técnicas, mas campos que ele não reporta
      // não podem apagar informações cadastradas manualmente no inventário.
      const visibleSpecs = presentSpecs({
        windows: nullable(item.operatingSystem),
        placa_mae: nullable(item.motherboard),
        processador: nullable(item.processor),
        placa_video: nullable(item.videoCard),
        ram: nullable(item.memory),
        ram_pentes: item.memoryModules ?? null,
        armazenamento: nullable(item.storage),
        mac_cabo: nullable(item.macCable),
        mac_wifi: nullable(item.macWifi),
        ip: nullable(item.ipAddress),
        antivirus: nullable(item.antivirus),
        anydesk_id: nullable(item.anydeskCode),
        ccleaner: item.ccleanerInstalled ?? null,
      })
      if (existing) {
        const specs = typeof existing.specs === 'object' && existing.specs && !Array.isArray(existing.specs)
          ? { ...existing.specs, ...visibleSpecs, glpi: glpiSpecs }
          : { ...visibleSpecs, glpi: glpiSpecs }
        await tx.inventoryEquipment.update({
          where: { id: existing.id },
          data: {
            name: item.name,
            serialNumber: nullable(item.serialNumber),
            // Corrige registros criados pelo conector antigo sem remover uma TAG
            // que tenha sido definida manualmente depois.
            assetTag: existing.assetTag === otherSerial ? null : undefined,
            specs,
            revision: { increment: 1 },
          },
        })
        updated += 1
      } else {
        const equipment = await tx.inventoryEquipment.create({
          data: {
            portalId: portal.id,
            categoryId: category.id,
            legacySource: 'glpi',
            legacyId: item.id,
            name: item.name,
            serialNumber: nullable(item.serialNumber),
            status: InventoryEquipmentStatus.ACTIVE,
            specs: { ...visibleSpecs, glpi: glpiSpecs },
          },
        })
        await tx.auditLog.create({
          data: {
            portalId: portal.id,
            bitrixUserId: 'GLPI_SYNC',
            action: 'GLPI_IMPORTED',
            entityType: 'EQUIPMENT',
            entityId: equipment.id,
            metadata: { glpiComputerId: item.id },
          },
        })
        created += 1
      }
    }
  })

  return { created, updated, total: payload.items.length }
}

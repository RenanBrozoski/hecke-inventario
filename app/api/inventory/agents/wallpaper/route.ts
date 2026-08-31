import { z } from 'zod'
import {
  inventoryErrorResponse,
  jsonOk,
  parseJsonBody,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  url: z.string().url().max(2048),
  style: z.enum(['FILL', 'FIT', 'STRETCH', 'TILE', 'CENTER']).default('FILL'),
  targetIds: z.array(z.string()).optional(),
})

export async function POST(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')

    const { url, style, targetIds } = bodySchema.parse(await parseJsonBody(request))

    const all = await prisma.inventoryEquipment.findMany({
      where: { portalId: context.portalId, status: { not: 'INACTIVE' } },
      select: { id: true, name: true, serialNumber: true, specs: true },
    })

    const withAgent = all.filter((eq) => {
      const s = eq.specs as Record<string, unknown> | null
      return s?.collector != null && typeof (s.collector as Record<string, unknown>)?.syncedAt === 'string'
    })

    const targets = targetIds?.length
      ? withAgent.filter((eq) => targetIds.includes(eq.id))
      : withAgent

    if (!targets.length) return jsonOk({ queued: 0, skipped: 0 })

    await prisma.collectorCommand.createMany({
      data: targets.map((eq) => ({
        portalId: context.portalId,
        equipmentId: eq.id,
        targetSerial: eq.serialNumber ?? null,
        targetName: eq.name,
        command: 'SET_WALLPAPER',
        params: { url, style },
        status: 'PENDING',
        createdBy: context.bitrixUserId,
      })),
    })

    return jsonOk({ queued: targets.length, skipped: withAgent.length - targets.length })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

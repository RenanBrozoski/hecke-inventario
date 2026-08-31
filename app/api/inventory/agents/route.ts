import {
  inventoryErrorResponse,
  jsonOk,
  requireInventoryContext,
  requireInventoryRole,
} from '@/src/modules/inventory/http'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'OPERATOR')

    const all = await prisma.inventoryEquipment.findMany({
      where: { portalId: context.portalId, status: { not: 'INACTIVE' } },
      select: {
        id: true,
        name: true,
        serialNumber: true,
        specs: true,
        status: true,
        category: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    const items = all
      .filter((eq) => {
        const s = eq.specs as Record<string, unknown> | null
        return s?.collector != null && typeof (s.collector as Record<string, unknown>)?.syncedAt === 'string'
      })
      .map((eq) => {
        const s = eq.specs as Record<string, unknown>
        const col = s.collector as Record<string, string>
        return {
          id: eq.id,
          name: eq.name,
          serialNumber: eq.serialNumber,
          categoryName: (eq.category as { name: string } | null)?.name ?? null,
          status: eq.status,
          syncedAt: col.syncedAt,
          matchedBy: col.matchedBy ?? null,
          os: (s.sistema_operacional as string | null) ?? null,
          ip: (s.ip as string | null) ?? null,
          anydeskId: (s.anydesk_id as string | null) ?? null,
        }
      })

    return jsonOk({ items })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

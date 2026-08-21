import { z } from 'zod'
import { inventoryErrorResponse, requireInventoryContext } from '@/src/modules/inventory/http'
import { searchParamsObject } from '@/src/modules/inventory/schemas'
import { exportInventoryEquipmentCsv } from '@/src/modules/inventory/report-service'

export const dynamic = 'force-dynamic'

const querySchema = z.object({ categoryId: z.string().trim().min(1).max(100).optional() })

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const query = querySchema.parse(searchParamsObject(new URL(request.url)))
    const { csv } = await exportInventoryEquipmentCsv(portalId, query.categoryId)
    const suffix = query.categoryId ? '-categoria' : ''
    return new Response(csv, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="inventario${suffix}.csv"`,
        'Content-Type': 'text/csv; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

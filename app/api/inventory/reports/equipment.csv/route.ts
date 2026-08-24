import { z } from 'zod'
import { inventoryErrorResponse, requireInventoryContext } from '@/src/modules/inventory/http'
import { searchParamsObject } from '@/src/modules/inventory/schemas'
import { exportInventoryEquipmentCsv } from '@/src/modules/inventory/report-service'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  categoryId: z.string().trim().min(1).max(100).optional(),
  status: z.string().trim().min(1).max(50).optional(),
  departmentId: z.string().trim().min(1).max(100).optional(),
  locationId: z.string().trim().min(1).max(100).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  archived: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
})

export async function GET(request: Request) {
  try {
    const { portalId } = await requireInventoryContext(request)
    const query = querySchema.parse(searchParamsObject(new URL(request.url)))
    const { csv } = await exportInventoryEquipmentCsv(portalId, query)
    const suffix = query.categoryId ? '-categoria' : query.status ? `-${query.status.toLowerCase()}` : ''
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

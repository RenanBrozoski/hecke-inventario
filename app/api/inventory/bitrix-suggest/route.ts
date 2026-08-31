import { inventoryErrorResponse, jsonOk, requireInventoryContext } from '@/src/modules/inventory/http'
import { searchBitrixUsers } from '@/src/lib/bitrix24'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const ctx = await requireInventoryContext(request)

    const people = await prisma.inventoryPerson.findMany({
      where: {
        portalId: ctx.portalId,
        archivedAt: null,
        bitrixUserId: null,
        bitrixMatchStatus: { not: 'REJECTED' },
        status: { not: 'TERMINATED' },
      },
      select: { id: true, name: true, revision: true },
      orderBy: { name: 'asc' },
      take: 25,
    })

    const results = await Promise.all(
      people.map(async (person) => {
        try {
          const matches = await searchBitrixUsers(person.name)
          if (!matches.length) return null
          return {
            person: { id: person.id, name: person.name, revision: person.revision },
            matches: matches.slice(0, 4).map((u) => ({
              bitrixId: u.ID,
              bitrixName: `${u.NAME} ${u.LAST_NAME}`.trim(),
              email: u.EMAIL ?? '',
            })),
          }
        } catch {
          return null
        }
      }),
    )

    return jsonOk(results.filter(Boolean))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

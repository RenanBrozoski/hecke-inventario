import { inventoryErrorResponse, jsonOk, requireInventoryContext, requireInventoryRole } from '@/src/modules/inventory/http'
import { getAllActiveBitrixUsers, getBitrixUsersByIds } from '@/src/lib/bitrix24'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

// GET — preview: list active Bitrix users and indicate which already exist in the system
export async function GET(request: Request) {
  try {
    const ctx = await requireInventoryContext(request)

    // Fetch up to 100 active Bitrix users (no FIND filter = all active users)
    const bitrixUsers = await getAllActiveBitrixUsers()

    const existingLinks = await prisma.inventoryPerson.findMany({
      where: { portalId: ctx.portalId, archivedAt: null, bitrixUserId: { not: null } },
      select: { bitrixUserId: true, id: true, name: true },
    })
    const linkedMap = new Map(existingLinks.map((p) => [p.bitrixUserId, p]))

    const users = bitrixUsers.map((u) => {
      const existing = linkedMap.get(u.ID)
      return {
        bitrixId: u.ID,
        bitrixName: `${u.NAME} ${u.LAST_NAME}`.trim(),
        email: u.EMAIL ?? '',
        photo: u.PERSONAL_PHOTO ?? null,
        alreadyLinked: existing != null,
        linkedPersonId: existing?.id ?? null,
        linkedPersonName: existing?.name ?? null,
      }
    })

    return jsonOk({ users, total: users.length })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

// POST — import selected Bitrix users as new collaborators
export async function POST(request: Request) {
  try {
    const ctx = await requireInventoryContext(request)
    requireInventoryRole(ctx, 'OPERATOR')

    const body = (await request.json()) as { userIds: string[] }
    const { userIds } = body
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return jsonOk({ created: 0, skipped: 0 })
    }

    // Fetch only the selected users from Bitrix (avoids fetching all active users)
    const selectedUsers = await getBitrixUsersByIds(userIds)

    // Check which already have a Bitrix link
    const existingIds = await prisma.inventoryPerson.findMany({
      where: {
        portalId: ctx.portalId,
        archivedAt: null,
        bitrixUserId: { in: userIds },
      },
      select: { bitrixUserId: true },
    })
    const alreadyLinked = new Set(existingIds.map((p) => p.bitrixUserId))

    const toCreate = selectedUsers.filter((u) => !alreadyLinked.has(u.ID))

    // Check for name conflicts with existing unlinked persons to prevent duplicates
    const existingUnlinked = await prisma.inventoryPerson.findMany({
      where: { portalId: ctx.portalId, archivedAt: null, bitrixUserId: null },
      select: { id: true, name: true },
    })
    const existingNames = new Set(existingUnlinked.map((p) => p.name.toLowerCase().trim()))
    const conflicts = toCreate.filter((u) =>
      existingNames.has(`${u.NAME} ${u.LAST_NAME}`.trim().toLowerCase()),
    )
    const safeToCreate = toCreate.filter(
      (u) => !existingNames.has(`${u.NAME} ${u.LAST_NAME}`.trim().toLowerCase()),
    )

    if (safeToCreate.length > 0) {
      await prisma.inventoryPerson.createMany({
        data: safeToCreate.map((u) => ({
          portalId: ctx.portalId,
          name: `${u.NAME} ${u.LAST_NAME}`.trim(),
          email: u.EMAIL ?? null,
          bitrixUserId: u.ID,
          bitrixMatchStatus: 'MATCHED',
          bitrixMatchMethod: 'IMPORT',
        })),
        skipDuplicates: true,
      })
    }

    return jsonOk({
      created: safeToCreate.length,
      skipped: selectedUsers.length - toCreate.length,
      conflicts: conflicts.map((u) => ({
        bitrixId: u.ID,
        name: `${u.NAME} ${u.LAST_NAME}`.trim(),
      })),
    })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

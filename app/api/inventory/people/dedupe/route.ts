import { inventoryErrorResponse, jsonOk, requireInventoryContext, requireInventoryRole } from '@/src/modules/inventory/http'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// GET — find candidate duplicate pairs
export async function GET(request: Request) {
  try {
    const ctx = await requireInventoryContext(request)
    requireInventoryRole(ctx, 'ADMIN')

    const people = await prisma.inventoryPerson.findMany({
      where: { portalId: ctx.portalId, archivedAt: null },
      select: { id: true, name: true, email: true, bitrixUserId: true },
      orderBy: { name: 'asc' },
    })

    const pairs: { a: typeof people[0]; b: typeof people[0] }[] = []

    for (let i = 0; i < people.length; i++) {
      const a = people[i]!
      const na = normalizeName(a.name)
      for (let j = i + 1; j < people.length; j++) {
        const b = people[j]!
        const nb = normalizeName(b.name)
        // exact match, or one is a prefix of the other separated by a space
        const similar =
          na === nb ||
          nb.startsWith(na + ' ') ||
          na.startsWith(nb + ' ')
        if (similar) {
          pairs.push({ a, b })
        }
      }
    }

    return jsonOk({ pairs })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

// POST — merge loser into winner, then archive loser
export async function POST(request: Request) {
  try {
    const ctx = await requireInventoryContext(request)
    requireInventoryRole(ctx, 'ADMIN')

    const body = (await request.json()) as { winnerId: string; loserId: string }
    const { winnerId, loserId } = body
    if (!winnerId || !loserId || winnerId === loserId) {
      return inventoryErrorResponse(new Error('Parâmetros inválidos.'))
    }

    // Verify both belong to this portal and are active
    const [winner, loser] = await Promise.all([
      prisma.inventoryPerson.findFirst({
        where: { id: winnerId, portalId: ctx.portalId, archivedAt: null },
        select: { id: true, name: true },
      }),
      prisma.inventoryPerson.findFirst({
        where: { id: loserId, portalId: ctx.portalId, archivedAt: null },
        select: { id: true, name: true },
      }),
    ])

    if (!winner || !loser) {
      return inventoryErrorResponse(new Error('Pessoa não encontrada ou já arquivada.'))
    }

    await prisma.$transaction(async (tx) => {
      // Reassign all FK references from loser → winner
      await tx.inventoryEquipment.updateMany({
        where: { portalId: ctx.portalId, currentHolderId: loserId },
        data: { currentHolderId: winnerId },
      })
      await tx.inventoryMovement.updateMany({
        where: { portalId: ctx.portalId, fromPersonId: loserId },
        data: { fromPersonId: winnerId },
      })
      await tx.inventoryMovement.updateMany({
        where: { portalId: ctx.portalId, toPersonId: loserId },
        data: { toPersonId: winnerId },
      })
      await tx.inventoryCorporateLine.updateMany({
        where: { portalId: ctx.portalId, currentHolderId: loserId },
        data: { currentHolderId: winnerId },
      })
      await tx.inventoryCorporateLineHistory.updateMany({
        where: { portalId: ctx.portalId, fromHolderId: loserId },
        data: { fromHolderId: winnerId },
      })
      await tx.inventoryCorporateLineHistory.updateMany({
        where: { portalId: ctx.portalId, toHolderId: loserId },
        data: { toHolderId: winnerId },
      })
      await tx.inventoryTerm.updateMany({
        where: { portalId: ctx.portalId, personId: loserId },
        data: { personId: winnerId },
      })
      await tx.inventoryTerm.updateMany({
        where: { portalId: ctx.portalId, destinationPersonId: loserId },
        data: { destinationPersonId: winnerId },
      })

      // Archive the loser
      await tx.inventoryPerson.update({
        where: { id: loserId },
        data: { archivedAt: new Date() },
      })
    })

    return jsonOk({ merged: true, winnerId, loserId })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

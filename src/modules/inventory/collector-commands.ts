import { z } from 'zod'
import { prisma } from '@/src/lib/prisma'
import { InventoryNotFoundError, InventoryValidationError } from './http'

export const COLLECTOR_COMMAND_TYPES = ['SET_WALLPAPER', 'SHOW_MESSAGE', 'MAP_DRIVE'] as const
export type CollectorCommandType = (typeof COLLECTOR_COMMAND_TYPES)[number]

export const commandParamsSchema: Record<CollectorCommandType, z.ZodTypeAny> = {
  SET_WALLPAPER: z.object({
    url: z.string().url().max(2048),
    style: z.enum(['FILL', 'FIT', 'STRETCH', 'TILE', 'CENTER']).default('FILL'),
  }),
  SHOW_MESSAGE: z.object({
    title: z.string().min(1).max(120),
    body: z.string().min(1).max(500),
  }),
  MAP_DRIVE: z.object({
    letter: z.string().regex(/^[A-Z]$/).transform((s) => s.toUpperCase()),
    path: z.string().min(5).max(260),
  }),
}

export const createCommandSchema = z.object({
  equipmentId: z.string().cuid(),
  command: z.enum(COLLECTOR_COMMAND_TYPES),
  params: z.record(z.unknown()),
})

/** Cria um novo comando pendente para um equipamento. */
export async function createCollectorCommand(
  portalId: string,
  input: z.infer<typeof createCommandSchema>,
  createdBy?: string,
) {
  const equipment = await prisma.inventoryEquipment.findFirst({
    where: { id: input.equipmentId, portalId, archivedAt: null },
    select: { id: true, name: true, serialNumber: true, specs: true },
  })
  if (!equipment) throw new InventoryNotFoundError('Equipamento não encontrado.')

  const specs = equipment.specs as Record<string, unknown>
  const hasAgent = !!(specs.collector as Record<string, unknown> | undefined)?.syncedAt
  if (!hasAgent)
    throw new InventoryValidationError(
      'Este equipamento não tem o agente coletor instalado. Instale o inventory-agent.ps1 primeiro.',
    )

  const paramsSchema = commandParamsSchema[input.command]
  const params = paramsSchema.parse(input.params)

  const command = await prisma.collectorCommand.create({
    data: {
      portalId,
      equipmentId: equipment.id,
      targetSerial: equipment.serialNumber ?? null,
      targetName: equipment.name ?? null,
      command: input.command,
      params,
      status: 'PENDING',
      createdBy: createdBy ?? null,
    },
  })

  return command
}

/** Retorna os comandos PENDING para um determinado agente (serial ou hostname). */
export async function getPendingCommands(
  portalId: string,
  targetSerial: string | null,
  targetName: string | null,
) {
  const conditions = []
  if (targetSerial) conditions.push({ targetSerial })
  if (targetName) conditions.push({ targetName })
  if (conditions.length === 0) return []

  const commands = await prisma.collectorCommand.findMany({
    where: { portalId, status: 'PENDING', OR: conditions },
    orderBy: { createdAt: 'asc' },
    select: { id: true, command: true, params: true },
  })

  // Marca como SENT para evitar reenvio em caso de crash do agente
  if (commands.length > 0) {
    await prisma.collectorCommand.updateMany({
      where: { id: { in: commands.map((c) => c.id) } },
      data: { status: 'SENT', sentAt: new Date() },
    })
  }

  return commands
}

/** Registra o resultado de um comando executado pelo agente. */
export async function markCommandDone(
  portalId: string,
  commandId: string,
  success: boolean,
  result: string | null,
) {
  const command = await prisma.collectorCommand.findFirst({
    where: { id: commandId, portalId, status: { in: ['PENDING', 'SENT'] } },
    select: { id: true },
  })
  if (!command) throw new InventoryNotFoundError('Comando não encontrado.')

  await prisma.collectorCommand.update({
    where: { id: command.id },
    data: {
      status: success ? 'DONE' : 'FAILED',
      result: result?.slice(0, 500) ?? null,
      doneAt: new Date(),
    },
  })
}

/** Lista os últimos comandos de um equipamento (para exibir na UI). */
export async function listEquipmentCommands(portalId: string, equipmentId: string) {
  return prisma.collectorCommand.findMany({
    where: { portalId, equipmentId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      command: true,
      params: true,
      status: true,
      result: true,
      createdAt: true,
      sentAt: true,
      doneAt: true,
    },
  })
}

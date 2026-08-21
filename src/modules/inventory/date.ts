export const INVENTORY_TIME_ZONE = 'America/Sao_Paulo'

/** Data civil do inventário, independente do fuso do processo/navegador. */
export function inventoryDateOnlyToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: INVENTORY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

/** Prisma @db.Date recebe meia-noite UTC representando a data civil, não um instante local. */
export function inventoryTodayUtc(now: Date = new Date()): Date {
  return new Date(`${inventoryDateOnlyToday(now)}T00:00:00.000Z`)
}

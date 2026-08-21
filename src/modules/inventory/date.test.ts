import { describe, expect, it } from 'vitest'
import { inventoryDateOnlyToday, inventoryTodayUtc } from './date'

describe('data civil do inventário', () => {
  it('mantém o dia de São Paulo quando UTC já virou para o dia seguinte', () => {
    const instant = new Date('2026-08-21T01:30:00.000Z')
    expect(inventoryDateOnlyToday(instant)).toBe('2026-08-20')
    expect(inventoryTodayUtc(instant).toISOString()).toBe('2026-08-20T00:00:00.000Z')
  })
})

import { describe, expect, it } from 'vitest'
import { EQUIPMENT_STATUS_LABELS, equipmentLabel, formatDate, statusTone } from './format'

describe('inventory format helpers', () => {
  it('formata data civil sem deslocamento de fuso', () => {
    expect(formatDate('2026-08-20T00:00:00.000Z')).toBe('20/08/2026')
  })

  it('monta identificação com fallback estável', () => {
    expect(equipmentLabel({ id: 'eq-1', patrimony: 'NB001', name: 'Notebook' })).toBe(
      'NB001 — Notebook',
    )
    expect(equipmentLabel({ id: 'eq-2', patrimony: null, name: null })).toBe('#eq-2')
  })

  it('mantém os seis status legados traduzidos', () => {
    expect(Object.keys(EQUIPMENT_STATUS_LABELS)).toHaveLength(6)
    expect(EQUIPMENT_STATUS_LABELS.MAINTENANCE).toBe('Em manutenção')
    expect(statusTone('BROKEN')).toBe('danger')
    expect(statusTone('STOCK')).toBe('neutral')
  })
})

import { describe, expect, it } from 'vitest'
import { EQUIPMENT_STATUS_LABELS, equipmentLabel, formatDate, readApiError, statusTone } from './format'

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

  it('mantém os status operacionais traduzidos, inclusive roubado', () => {
    expect(Object.keys(EQUIPMENT_STATUS_LABELS)).toHaveLength(7)
    expect(EQUIPMENT_STATUS_LABELS.MAINTENANCE).toBe('Em manutenção')
    expect(EQUIPMENT_STATUS_LABELS.LOST).toBe('Roubado / extraviado')
    expect(statusTone('BROKEN')).toBe('danger')
    expect(statusTone('LOST')).toBe('danger')
    expect(statusTone('STOCK')).toBe('neutral')
  })

  it('substitui erro interno por uma ação contextual, mas mantém regras de negócio', async () => {
    await expect(
      readApiError(
        Response.json({ error: 'Erro interno.' }, { status: 500 }),
        'Não foi possível excluir o equipamento.',
      ),
    ).resolves.toBe('Não foi possível excluir o equipamento.')
    await expect(
      readApiError(
        Response.json({ error: 'Mova os equipamentos antes de desativar este local.' }, { status: 409 }),
        'Falha.',
      ),
    ).resolves.toBe('Mova os equipamentos antes de desativar este local.')
  })
})

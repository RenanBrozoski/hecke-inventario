import { describe, expect, it } from 'vitest'
import {
  bulkTransferSchema,
  createEquipmentSchema,
  equipmentListQuerySchema,
  termSchema,
  transferEquipmentSchema,
  updateEquipmentSchema,
  updatePersonSchema,
} from './schemas'

describe('schemas HTTP do Inventário', () => {
  it('rejeita portalId e ator enviados pelo cliente', () => {
    expect(
      createEquipmentSchema.safeParse({ categoryId: 'cat-1', portalId: 'portal-invadido' }).success,
    ).toBe(false)
    expect(
      createEquipmentSchema.safeParse({ categoryId: 'cat-1', bitrixUserId: 'ator-forjado' })
        .success,
    ).toBe(false)
  })

  it('limita paginação e valida enum de filtro', () => {
    expect(equipmentListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false)
    expect(equipmentListQuerySchema.safeParse({ status: 'QUALQUER' }).success).toBe(false)
    expect(equipmentListQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 25,
      archived: 'exclude',
    })
  })

  it('aceita grupo de categorias para separar tipos de ativos', () => {
    expect(equipmentListQuerySchema.parse({ categoryIds: 'desktop,notebook,desktop' })).toMatchObject({
      categoryIds: ['desktop', 'notebook'],
    })
    expect(equipmentListQuerySchema.safeParse({ categoryIds: ',' }).success).toBe(false)
  })

  it('exige revisão e uma mudança na transferência', () => {
    expect(transferEquipmentSchema.safeParse({ revision: 1 }).success).toBe(false)
    expect(transferEquipmentSchema.safeParse({ revision: 1, locationId: null }).success).toBe(true)
  })

  it('aceita posse/setor no editor, que o serviço converte em movimento', () => {
    expect(
      updateEquipmentSchema.safeParse({ revision: 1, currentHolderId: 'person-2' }).success,
    ).toBe(true)
    expect(updateEquipmentSchema.safeParse({ revision: 1, departmentId: null }).success).toBe(true)
  })

  it('rejeita datas inexistentes e updates vazios', () => {
    expect(
      createEquipmentSchema.safeParse({ categoryId: 'cat-1', acquiredAt: '2026-02-30' }).success,
    ).toBe(false)
    expect(updatePersonSchema.safeParse({}).success).toBe(false)
  })

  it('valida seleção e revisões exatas da transferência em lote', () => {
    const valid = {
      equipmentIds: ['eq-1', 'eq-2'],
      expectedRevisions: { 'eq-1': 3, 'eq-2': 7 },
      destinationPersonId: null,
      movedAt: '2026-08-20',
      reason: null,
      createTerm: true,
    }
    expect(bulkTransferSchema.safeParse(valid).success).toBe(true)
    expect(
      bulkTransferSchema.safeParse({
        ...valid,
        equipmentIds: ['eq-1', 'eq-1'],
      }).success,
    ).toBe(false)
    expect(
      bulkTransferSchema.safeParse({
        ...valid,
        expectedRevisions: { 'eq-1': 3 },
      }).success,
    ).toBe(false)
    expect(
      bulkTransferSchema.safeParse({
        ...valid,
        portalId: 'portal-invadido',
      }).success,
    ).toBe(false)
  })

  it('aceita somente IDs em termos manuais e reserva transferência ao fluxo atômico', () => {
    const valid = {
      type: 'RESPONSIBILITY',
      personId: 'person-1',
      equipmentIds: ['eq-1'],
      expectedRevisions: { 'eq-1': 1 },
      observations: null,
    }
    expect(termSchema.safeParse(valid).success).toBe(true)
    // a revisão esperada de cada equipamento é obrigatória (CAS na emissão)
    expect(termSchema.safeParse({ ...valid, expectedRevisions: undefined }).success).toBe(false)
    expect(termSchema.safeParse({ ...valid, type: 'TRANSFER' }).success).toBe(false)
    expect(termSchema.safeParse({ ...valid, equipmentIds: ['eq-1', 'eq-1'] }).success).toBe(false)
    expect(
      termSchema.safeParse({
        ...valid,
        items: [{ equipmentId: 'eq-1', name: 'snapshot forjado' }],
      }).success,
    ).toBe(false)
  })
})

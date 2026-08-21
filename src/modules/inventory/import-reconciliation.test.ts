import { describe, expect, it } from 'vitest'
import type { InventoryExportDocument } from './import-format'
import { normalizeIdentity, reconcileInventoryIdentities } from './import-reconciliation'

function documentWithPeople(): InventoryExportDocument {
  return {
    _meta: { exportado_em: '2026-08-20T13:13:51', origem: 'teste', versao: 1 },
    categorias: [],
    setores: [{ id: 1, nome: 'Tecnologia da Informação', descricao: null }],
    locais: [],
    colaboradores: [
      {
        id: 1,
        nome: 'João da Silva',
        department_id: 1,
        cargo: null,
        email: null,
        matricula: null,
        tipo_vinculo: null,
        status: 'ativo',
        observacoes: null,
      },
      {
        id: 2,
        nome: 'Maria Souza',
        department_id: null,
        cargo: null,
        email: 'MARIA@EXAMPLE.COM ',
        matricula: null,
        tipo_vinculo: null,
        status: 'ativo',
        observacoes: null,
      },
    ],
    equipamentos: [],
    historico_transferencias: [],
    ramais: [],
    recebimentos: [],
    abas_personalizadas: [],
    termos: [],
    anexos: [],
    usuarios_sistema: [],
    auditoria: [],
  }
}

describe('reconcileInventoryIdentities', () => {
  it('normaliza acentos/espaços sem fuzzy matching', () => {
    expect(normalizeIdentity('  JOÃO   da Silva ')).toBe('joao da silva')
  })

  it('associa e-mail único e nome único somente com setor confirmado', () => {
    const plan = reconcileInventoryIdentities(
      documentWithPeople(),
      [{ bitrixDepartmentId: '10', name: 'Tecnologia da Informacao', active: true }],
      [
        {
          bitrixUserId: '100',
          fullName: 'Joao da Silva',
          email: null,
          departmentIds: ['10'],
          active: true,
        },
        {
          bitrixUserId: '200',
          fullName: 'Outro Nome',
          email: 'maria@example.com',
          departmentIds: [],
          active: true,
        },
      ],
    )

    expect(plan.departments.get(1)).toMatchObject({ status: 'MATCHED', bitrixDepartmentId: '10' })
    expect(plan.people.get(1)).toMatchObject({
      status: 'MATCHED',
      bitrixUserId: '100',
      method: 'normalized_name_unique_department_confirmed',
    })
    expect(plan.people.get(2)).toMatchObject({
      status: 'MATCHED',
      bitrixUserId: '200',
      method: 'email_exact_unique',
    })
  })

  it('não associa automaticamente nome sem confirmação de setor', () => {
    const document = documentWithPeople()
    document.colaboradores[0]!.department_id = null
    const plan = reconcileInventoryIdentities(
      document,
      [],
      [
        {
          bitrixUserId: '100',
          fullName: 'João da Silva',
          email: null,
          departmentIds: [],
          active: true,
        },
      ],
    )

    expect(plan.people.get(1)).toMatchObject({ status: 'AMBIGUOUS', bitrixUserId: null })
  })
})

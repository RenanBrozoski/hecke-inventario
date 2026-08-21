import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import {
  InventoryImportValidationError,
  canonicalFingerprintBytes,
  prepareInventoryExport,
} from './import-format'

function emptySections() {
  return {
    categorias: [],
    setores: [],
    locais: [],
    colaboradores: [],
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

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function v1WithPassword() {
  return {
    _meta: {
      exportado_em: '2026-08-20T13:13:51.025268',
      origem: 'Inventario Hecke (Flask/SQLite)',
      versao: 1,
    },
    ...emptySections(),
    categorias: [
      {
        id: 1,
        nome: 'Smartphone',
        prefixo: 'SM',
        icone: 'phone',
        descricao: null,
        ordem: 1,
        campos: [
          {
            id: 10,
            chave: 'senha_email',
            rotulo: 'Senha do e-mail',
            tipo: 'senha',
            opcoes: null,
            ordem: 1,
            obrigatorio: false,
            mostrar_na_lista: false,
          },
          {
            id: 11,
            chave: 'quantidade',
            rotulo: 'Quantidade',
            tipo: 'numero',
            opcoes: null,
            ordem: 2,
            obrigatorio: false,
            mostrar_na_lista: false,
          },
          {
            id: 12,
            chave: 'configurado',
            rotulo: 'Configurado',
            tipo: 'booleano',
            opcoes: null,
            ordem: 3,
            obrigatorio: false,
            mostrar_na_lista: false,
          },
          {
            id: 13,
            chave: 'configurado_em',
            rotulo: 'Configurado em',
            tipo: 'data',
            opcoes: null,
            ordem: 4,
            obrigatorio: false,
            mostrar_na_lista: false,
          },
        ],
      },
    ],
    equipamentos: [
      {
        id: 100,
        patrimonio: 'SM001',
        tag_patrimonio: null,
        nome: null,
        category_id: 1,
        status: 'ativo',
        current_holder_id: null,
        department_id: null,
        location_id: null,
        localizacao: null,
        numero_serie: null,
        nota_fiscal: null,
        data_aquisicao: null,
        data_recebimento: null,
        data_entrega: null,
        data_garantia: null,
        observacoes: null,
        created_at: '2026-06-11T20:25:41.000000',
        updated_at: '2026-06-11T20:25:41.000000',
        categoria_nome: 'Smartphone',
        specs: {
          senha_email: 'não deve persistir',
          quantidade: '2,5',
          configurado: 'Sim',
          configurado_em: '20/08/2026',
        },
      },
    ],
  }
}

function safeV2(sections = emptySections()) {
  const fingerprint = createHash('sha256').update(canonicalFingerprintBytes(sections)).digest('hex')
  return {
    _meta: {
      exportado_em: '2026-08-20T14:30:00Z',
      origem: 'Inventario Hecke (Flask/SQLite)',
      versao: 2,
      modo_leitura: 'mode=ro + query_only',
      integridade: {
        sqlite_integrity_check: 'ok',
        violacoes_chave_estrangeira: 0,
        contagens_validadas: true,
      },
      manifesto_contagens: {
        users: sections.usuarios_sistema.length,
        departments: sections.setores.length,
        people: sections.colaboradores.length,
        locations: sections.locais.length,
        categories: sections.categorias.length,
        custom_fields: sections.categorias.reduce(
          (sum: number, item: { campos: unknown[] }) => sum + item.campos.length,
          0,
        ),
        equipment: sections.equipamentos.length,
        assignment_history: sections.historico_transferencias.length,
        extensions: sections.ramais.length,
        receiving: sections.recebimentos.length,
        custom_modules: sections.abas_personalizadas.length,
        custom_module_fields: sections.abas_personalizadas.reduce(
          (sum: number, item: { campos: unknown[] }) => sum + item.campos.length,
          0,
        ),
        custom_records: sections.abas_personalizadas.reduce(
          (sum: number, item: { registros: unknown[] }) => sum + item.registros.length,
          0,
        ),
        attachments: sections.anexos.length,
        termos: sections.termos.length,
        audit_log: sections.auditoria.length,
      },
      segredos_removidos: {
        aviso: 'Credenciais removidas.',
        politica: 'Chaves de senha omitidas.',
        users_password_hash_omitidos: sections.usuarios_sistema.length,
        campos_senha_declarados: 0,
        opcoes_omitidas_campos_senha: 0,
        valores_omitidos_equipamentos: 0,
        valores_omitidos_modulos: 0,
        trechos_omitidos_termos: 0,
        valores_omitidos_auditoria: 0,
      },
      fingerprint: {
        algoritmo: 'SHA-256',
        escopo: 'conteudo_exportado_redigido_sem_meta',
        canonizacao: 'typed-utf8-ieee754-v1',
        valor: fingerprint,
      },
    },
    ...sections,
  }
}

describe('prepareInventoryExport', () => {
  it('aceita v1, remove PASSWORD em memória e mantém as contagens', () => {
    const prepared = prepareInventoryExport(encode(v1WithPassword()))

    expect(prepared.document._meta.versao).toBe(1)
    expect(prepared.counts).toMatchObject({ categories: 1, custom_fields: 4, equipment: 1 })
    expect(prepared.document.equipamentos[0]!.specs).toEqual({
      quantidade: 2.5,
      configurado: true,
      configurado_em: '2026-08-20',
    })
    expect(prepared.sanitization.equipmentPasswordValuesRemoved).toBe(1)
    expect(prepared.normalization).toEqual({
      numberValuesNormalized: 1,
      booleanValuesNormalized: 1,
      dateValuesNormalized: 1,
      legacyValuesQuarantined: 0,
      equipmentWithQuarantinedValues: 0,
    })
    expect(prepared.warnings.join(' ')).toContain('sensível')
  })

  it('aceita v2 vazio quando manifesto e fingerprint conferem', () => {
    const prepared = prepareInventoryExport(encode(safeV2()))

    expect(prepared.document._meta.versao).toBe(2)
    expect(prepared.canonicalSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(prepared.warnings).toEqual([])
  })

  it('gera o mesmo fingerprint para números integrais independentemente da notação JSON', () => {
    const integer = createHash('sha256')
      .update(canonicalFingerprintBytes({ value: 1 }))
      .digest('hex')
    const negativeZero = createHash('sha256')
      .update(canonicalFingerprintBytes({ value: -0 }))
      .digest('hex')

    expect(integer).toBe('8f4b3126edabce0bd64c23785fee2aeb5386171dcd2924737d4a5a7a2e0b71c4')
    expect(negativeZero).toBe(
      createHash('sha256')
        .update(canonicalFingerprintBytes({ value: 0 }))
        .digest('hex'),
    )
  })

  it('rejeita alteração de conteúdo após o fingerprint v2', () => {
    const document = safeV2() as unknown as {
      locais: Array<{ id: number; nome: string; descricao: null; created_at: null }>
    }
    document.locais.push({ id: 1, nome: 'Matriz', descricao: null, created_at: null })

    expect(() => prepareInventoryExport(encode(document))).toThrowError(
      InventoryImportValidationError,
    )
    try {
      prepareInventoryExport(encode(document))
    } catch (error) {
      expect((error as InventoryImportValidationError).details.join(' ').toLowerCase()).toContain(
        'fingerprint',
      )
    }
  })

  it('rejeita referência inexistente antes de qualquer acesso ao banco', () => {
    const document = v1WithPassword()
    document.equipamentos[0]!.category_id = 999

    expect(() => prepareInventoryExport(encode(document))).toThrowError(/invariantes/)
  })

  it('rejeita valor dinâmico que não pode ser normalizado para o FieldType', () => {
    const document = v1WithPassword()
    document.equipamentos[0]!.specs.quantidade = 'dois'

    expect(() => prepareInventoryExport(encode(document))).toThrowError(/FieldType/)
  })
})

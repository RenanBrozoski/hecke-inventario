import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { prepareInventoryExport } from './import-format'
import { runInventoryImport } from './import-runner'

function emptyPrepared() {
  return prepareInventoryExport(
    new TextEncoder().encode(
      JSON.stringify({
        _meta: { exportado_em: '2026-08-20T13:13:51', origem: 'teste', versao: 1 },
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
      }),
    ),
  )
}

describe('runInventoryImport --dry-run', () => {
  it('faz somente leituras e nunca abre uma transação de escrita', async () => {
    const noRows = { findMany: vi.fn().mockResolvedValue([]) }
    const transaction = vi.fn(() => {
      throw new Error('dry-run tentou escrever')
    })
    const prisma = {
      bitrixPortal: { findUnique: vi.fn().mockResolvedValue({ id: 'portal-1' }) },
      inventoryImportRun: noRows,
      inventoryCategory: noRows,
      inventoryDepartment: noRows,
      inventoryLocation: noRows,
      inventoryCustomModule: noRows,
      inventoryEquipment: noRows,
      bitrixDepartment: noRows,
      bitrixUser: noRows,
      $transaction: transaction,
    } as unknown as PrismaClient

    const report = await runInventoryImport({
      prisma,
      prepared: emptyPrepared(),
      portalId: 'portal-1',
      mode: 'dry-run',
      allowNewSnapshot: false,
    })

    expect(report.status).toBe('validated')
    expect(transaction).not.toHaveBeenCalled()
  })
})

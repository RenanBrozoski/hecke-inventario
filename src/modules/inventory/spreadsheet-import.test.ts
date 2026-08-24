import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { excelSerialDateToIso, parseSpreadsheet } from './spreadsheet-import'

function workbookBytes(sheets: Record<string, unknown[][]>) {
  const workbook = XLSX.utils.book_new()
  Object.entries(sheets).forEach(([name, rows]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name))
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('parser de planilha de inventário', () => {
  it('detecta linhas, normaliza telefone e nunca inclui segredo na prévia', () => {
    const parsed = parseSpreadsheet(new Uint8Array(workbookBytes({
      Linhas: [['Número', 'Plano', 'Titular', 'Senha'], ['(11) 99999-0000', '20 GB', 'Ana', 'nunca-exportar']],
    })), 'linhas.xlsx')
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]).toMatchObject({ kind: 'CORPORATE_LINE', disposition: 'CREATE', payload: { normalizedNumber: '5511999990000', holderName: 'Ana' } })
    expect(JSON.stringify(parsed.rows[0]?.payload)).not.toContain('nunca-exportar')
    expect(parsed.rows[0]?.sensitiveColumnsOmitted).toEqual(['Senha'])
  })

  it('converte datas seriais e deriva até duas linhas de smartphone', () => {
    const parsed = parseSpreadsheet(new Uint8Array(workbookBytes({
      Smartphones: [['Patrimônio', 'Modelo', 'Telefone 1', 'Telefone 2'], ['SM-1', 'Aparelho', '(11) 99999-0000', '(11) 98888-0000']],
    })), 'ativos.xlsx')
    expect(excelSerialDateToIso(45292)).toBe('2024-01-01')
    expect(parsed.rows.map((row) => row.kind)).toEqual(['EQUIPMENT', 'CORPORATE_LINE', 'CORPORATE_LINE'])
    expect(parsed.rows[1]?.payload.sourceEquipmentRowId).toBe(parsed.rows[0]?.id)
  })

  it('reconhece os cabeçalhos e nomes de aba das planilhas reais da Hecke', () => {
    const parsed = parseSpreadsheet(new Uint8Array(workbookBytes({
      'Desktops 2.0': [['PC', 'TAG', 'SETOR', 'Colaboradores', 'Data de recbto', 'Data de ent'], ['PC-1', 'TAG-1', 'TI', 'Ana', 45292, 45293]],
      Smartphone: [['SM', 'TAG', 'N° DE TELEFONE 1°', 'N° DE TELEFONE 2', 'N° DE TELEFONE 3'], ['SM-1', 'TAG-SM', '(11) 99999-0000', '(11) 98888-0000', '(11) 97777-0000']],
    })), 'exemplo-hecke.xlsx')
    expect(parsed.sheets.map((sheet) => sheet.template)).toEqual(['equipment:Desktop', 'equipment:Smartphone'])
    expect(parsed.rows[0]).toMatchObject({ payload: { patrimony: 'PC-1', assetTag: 'TAG-1', departmentName: 'TI', holderName: 'Ana', receivedAt: '2024-01-01' } })
    expect(parsed.rows.filter((row) => row.kind === 'CORPORATE_LINE')).toHaveLength(3)
  })
})

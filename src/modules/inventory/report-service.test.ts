import { describe, expect, it } from 'vitest'
import { serializeInventoryCsv } from './report-service'

describe('serializeInventoryCsv', () => {
  it('escapa aspas, usa separador compatível com Excel e adiciona BOM', () => {
    expect(
      serializeInventoryCsv([
        ['Nome', 'Obs'],
        ['Monitor', 'Tela "24"'],
      ]),
    ).toBe('\uFEFF"Nome";"Obs"\r\n"Monitor";"Tela ""24"""\r\n')
  })

  it('neutraliza células que poderiam executar fórmulas', () => {
    const csv = serializeInventoryCsv([['=HYPERLINK("https://example.test")', '+1', '-2', '@cmd']])
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).toContain("'+1")
    expect(csv).toContain("'-2")
    expect(csv).toContain("'@cmd")
  })
})

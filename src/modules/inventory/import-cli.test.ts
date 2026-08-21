import { describe, expect, it } from 'vitest'
import { parseImportCliArgs } from './import-cli'

describe('parseImportCliArgs', () => {
  it('exige portal, arquivo e exatamente um modo', () => {
    expect(() => parseImportCliArgs(['--file', 'a.json', '--portal', 'portal-1'])).toThrow(
      /exatamente um modo/,
    )
    expect(() =>
      parseImportCliArgs(['--file', 'a.json', '--portal', 'portal-1', '--dry-run', '--apply']),
    ).toThrow(/exatamente um modo/)
    expect(() => parseImportCliArgs(['--file', 'a.json', '--dry-run'])).toThrow(/--portal/)
  })

  it('aceita dry-run e confirmação explícita de novo snapshot', () => {
    expect(
      parseImportCliArgs([
        '--file',
        'a.json',
        '--portal',
        'portal-1',
        '--dry-run',
        '--allow-new-snapshot',
      ]),
    ).toMatchObject({ portalId: 'portal-1', mode: 'dry-run', allowNewSnapshot: true })
  })

  it('rejeita argumentos desconhecidos', () => {
    expect(() =>
      parseImportCliArgs(['--file', 'a.json', '--portal', 'p', '--dry-run', '--force']),
    ).toThrow(/desconhecido/)
  })
})

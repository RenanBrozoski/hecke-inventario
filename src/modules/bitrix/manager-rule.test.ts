import { describe, expect, it } from 'vitest'
import { deriveManagerBitrixUserId } from './manager-rule'

describe('deriveManagerBitrixUserId (Bloco 7, item 9)', () => {
  const departments = [
    { bitrixDepartmentId: '10', headBitrixUserId: '99' },
    { bitrixDepartmentId: '20', headBitrixUserId: null },
  ]

  it('retorna o head quando há exatamente um departamento com head definido e diferente do próprio usuário', () => {
    expect(deriveManagerBitrixUserId('1', ['10'], departments)).toBe('99')
  })

  it('retorna null quando o usuário pertence a múltiplos departamentos', () => {
    expect(deriveManagerBitrixUserId('1', ['10', '20'], departments)).toBeNull()
  })

  it('retorna null quando o usuário não pertence a nenhum departamento', () => {
    expect(deriveManagerBitrixUserId('1', [], departments)).toBeNull()
  })

  it('retorna null quando o departamento não tem head definido', () => {
    expect(deriveManagerBitrixUserId('1', ['20'], departments)).toBeNull()
  })

  it('nunca aponta a pessoa como gestora de si mesma', () => {
    expect(deriveManagerBitrixUserId('99', ['10'], departments)).toBeNull()
  })

  it('retorna null quando o departamento referenciado não existe na lista sincronizada', () => {
    expect(deriveManagerBitrixUserId('1', ['999'], departments)).toBeNull()
  })
})

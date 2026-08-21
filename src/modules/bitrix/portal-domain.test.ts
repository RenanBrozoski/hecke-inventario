import { describe, expect, it } from 'vitest'
import { resolvePortalDomain } from './portal-domain'

describe('resolvePortalDomain', () => {
  it('usa DOMAIN quando o Bitrix24 envia', () => {
    expect(resolvePortalDomain('hecke.bitrix24.com.br', undefined)).toBe('hecke.bitrix24.com.br')
  })

  it('cai para o host do SERVER_ENDPOINT quando DOMAIN não vem (payload real de instalação)', () => {
    expect(resolvePortalDomain(undefined, 'https://hecke.bitrix24.com.br/rest/')).toBe(
      'hecke.bitrix24.com.br',
    )
  })

  it('prefere DOMAIN quando os dois vêm', () => {
    expect(resolvePortalDomain('a.bitrix24.com.br', 'https://b.bitrix24.com.br/rest/')).toBe(
      'a.bitrix24.com.br',
    )
  })

  it('aceita DOMAIN com esquema e normaliza para host', () => {
    expect(resolvePortalDomain('https://hecke.bitrix24.com.br', undefined)).toBe(
      'hecke.bitrix24.com.br',
    )
  })

  it('recusa endpoint sem https — o valor alimenta a URL de validação REST', () => {
    expect(resolvePortalDomain(undefined, 'http://hecke.bitrix24.com.br/rest/')).toBeNull()
  })

  it('recusa DOMAIN com caminho, espaço ou lixo', () => {
    expect(resolvePortalDomain('hecke.bitrix24.com.br/rest', undefined)).toBeNull()
    expect(resolvePortalDomain('a b', undefined)).toBeNull()
  })

  it('devolve null quando nada utilizável chega', () => {
    expect(resolvePortalDomain(undefined, undefined)).toBeNull()
    expect(resolvePortalDomain('', '')).toBeNull()
  })
})

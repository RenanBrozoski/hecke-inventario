import { describe, expect, it } from 'vitest'
import { GET as appGET, POST as appPOST } from './route'

describe('/bitrix/app — só repassa para a página real (view)', () => {
  it('POST redireciona (303) para /bitrix/app/view sem processar o corpo', async () => {
    // O Bitrix24 sempre faz POST aqui na abertura — a identidade de quem
    // abriu é resolvida no navegador pelo SDK bitrix24.js (ver
    // src/modules/bitrix/launch.ts), não aqui.
    const response = await appPOST(new Request('https://bitrix-forms-432f.vercel.app/bitrix/app', { method: 'POST' }))

    expect(response.status).toBe(303)
    const location = response.headers.get('location')
    expect(new URL(location!).pathname).toBe('/bitrix/app/view')
  })

  it('GET repassa para /bitrix/app/view preservando a querystring', async () => {
    const response = await appGET(new Request('https://bitrix-forms-432f.vercel.app/bitrix/app?hs=abc123'))
    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    const url = new URL(location!)
    expect(url.pathname).toBe('/bitrix/app/view')
    expect(url.searchParams.get('hs')).toBe('abc123')
  })
})

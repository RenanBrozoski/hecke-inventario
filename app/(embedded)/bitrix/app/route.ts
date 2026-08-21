import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

/**
 * O Bitrix24 sempre faz POST direto na "URL inicial" do app (este caminho)
 * toda vez que ele é aberto — não só na instalação. Não processamos o corpo
 * do POST aqui: a identidade de quem abriu o app é resolvida DENTRO do
 * iframe, pelo SDK `bitrix24.js` carregado em ./view (ver
 * src/components/session/SessionProvider.tsx e
 * src/modules/bitrix/launch.ts para o porquê — validar o AUTH_ID deste POST
 * diretamente no servidor retorna ACCESS_DENIED neste portal). Este handler
 * só existe para receber o POST (page.tsx não aceita POST) e repassar para a
 * página real.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const target = new URL('/bitrix/app/view', request.url)
  // O Bitrix24 inclui DOMAIN/PROTOCOL/LANG/APP_SID na querystring da própria
  // URL de destino do POST (não só no corpo) — o SDK bitrix24.js parece
  // depender desse APP_SID para casar o handshake de postMessage com a
  // sessão certa no lado do Bitrix24. Preservar a querystring evita que
  // BX24.getAuth() volte vazio depois do redirect.
  target.search = new URL(request.url).search
  return NextResponse.redirect(target, { status: 303, headers: SECURITY_HEADERS })
}

// GET direto neste caminho (recarregar a aba, ou um link com `hs` de algum
// fluxo legado) também só repassa para a página real, preservando a querystring.
export async function GET(request: Request): Promise<NextResponse> {
  const target = new URL('/bitrix/app/view', request.url)
  target.search = new URL(request.url).search
  return NextResponse.redirect(target, { status: 307, headers: SECURITY_HEADERS })
}

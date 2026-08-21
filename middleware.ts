import { NextResponse } from 'next/server'
import { embeddedSecurityHeaders } from '@/src/modules/common/security-headers'

/**
 * Só existe porque `/bitrix/app/view` é uma página (page.tsx) e páginas não
 * têm como definir cabeçalhos de resposta arbitrários de outra forma no App
 * Router — as rotas de API (install/handler/exchange/refresh/me) e o
 * route.ts de `/bitrix/app` já aplicam os mesmos cabeçalhos diretamente nas
 * próprias respostas; aqui reforçamos de novo (defesa em profundidade) e
 * cobrimos a página, que não tem outro jeito.
 */
export function middleware() {
  const response = NextResponse.next()
  for (const [key, value] of Object.entries(embeddedSecurityHeaders())) {
    response.headers.set(key, value)
  }
  return response
}

export const config = {
  // Cobertura ampla deliberada (era uma lista fixa de rotas antes, que foi
  // ficando defasada a cada rota nova — ex.: /api/applications/**, /api/tasks,
  // /api/catalog nunca entraram na lista manual). `/api/:path*` cobre TODAS
  // as rotas de API (inclusive `/api/inngest`/`/api/health`, onde os
  // cabeçalhos são inofensivos — só endurecem a resposta, não mudam o corpo
  // nem quebram a introspecção do Inngest).
  matcher: [
    '/bitrix/:path*',
    '/inventory',
    '/inventory/:path*',
    '/api/:path*',
  ],
}

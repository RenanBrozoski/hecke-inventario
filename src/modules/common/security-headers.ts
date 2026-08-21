import { buildFrameAncestorsCsp } from '@/src/modules/bitrix/frame-ancestors'

/**
 * Cabeçalhos para as rotas/página relacionadas ao Bitrix24 embedded.
 * Deliberadamente NÃO define X-Frame-Options (bloquearia o carregamento em
 * iframe) e mantém a CSP restrita só a `frame-ancestors` — uma CSP completa de
 * script-src/style-src com nonce é um bom próximo passo, mas exigiria wiring
 * adicional no Next.js para não quebrar a hidratação; fica para uma fase futura.
 */
export function embeddedSecurityHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': buildFrameAncestorsCsp(),
  }
}

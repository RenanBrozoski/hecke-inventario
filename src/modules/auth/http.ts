import { NextResponse } from 'next/server'
import { SessionValidationError } from './session'

/**
 * Mapeamento único de erro de sessão -> resposta HTTP. Sempre 401 genérico —
 * nunca revela ao cliente qual foi a causa exata (ausente/expirada/portal
 * inativo/usuário inativo), só logs internos diferenciam isso.
 */
export function sessionErrorResponse(error: unknown): NextResponse {
  if (error instanceof SessionValidationError) {
    return NextResponse.json(
      { error: 'Não autorizado.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  return NextResponse.json({ error: 'Erro interno.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
}

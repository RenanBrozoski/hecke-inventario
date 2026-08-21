import type { InventoryRole } from '@prisma/client'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/src/lib/prisma'
import { requireSession } from '@/src/modules/auth/require-session'
import { SessionValidationError } from '@/src/modules/auth/session'
import { isPortalAdministrator } from '@/src/modules/bitrix/admin'

export interface InventoryContext {
  portalId: string
  bitrixUserId: string
  userName: string
  role: InventoryRole
}

export class InventoryForbiddenError extends Error {
  constructor(message = 'Você não tem permissão para executar esta ação no Inventário.') {
    super(message)
    this.name = 'InventoryForbiddenError'
  }
}

export class InventoryNotFoundError extends Error {
  constructor(message = 'Registro não encontrado.') {
    super(message)
    this.name = 'InventoryNotFoundError'
  }
}

export class InventoryConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventoryConflictError'
  }
}

export class InventoryValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: unknown[] = [],
  ) {
    super(message)
    this.name = 'InventoryValidationError'
  }
}

const NO_STORE = { 'Cache-Control': 'no-store' }
const ROLE_LEVEL: Record<InventoryRole, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 }

/**
 * Resolve portal, ator e papel em um único ponto. Administrador do portal
 * sempre prevalece sobre uma atribuição do módulo. Os demais usuários
 * precisam de atribuição explícita, inclusive para consulta: o Inventário
 * contém dados internos e não deve ser aberto automaticamente a todo o portal.
 */
export async function requireInventoryContext(request: Request): Promise<InventoryContext> {
  const { portal, user } = await requireSession(request)
  const portalAdmin = await isPortalAdministrator(portal.id, user.bitrixUserId)
  if (portalAdmin) {
    return {
      portalId: portal.id,
      bitrixUserId: user.bitrixUserId,
      userName: user.fullName,
      role: 'ADMIN',
    }
  }

  const assignment = await prisma.inventoryRoleAssignment.findUnique({
    where: {
      portalId_bitrixUserId: {
        portalId: portal.id,
        bitrixUserId: user.bitrixUserId,
      },
    },
    select: { role: true },
  })

  if (!assignment) {
    throw new InventoryForbiddenError(
      'Seu usuário não possui acesso ao Inventário. Solicite a liberação a um administrador.',
    )
  }

  return {
    portalId: portal.id,
    bitrixUserId: user.bitrixUserId,
    userName: user.fullName,
    role: assignment.role,
  }
}

export function requireInventoryRole(context: InventoryContext, minimum: InventoryRole): void {
  if (ROLE_LEVEL[context.role] < ROLE_LEVEL[minimum]) throw new InventoryForbiddenError()
}

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new InventoryValidationError('Corpo da requisição inválido (JSON malformado).')
  }
}

export function inventoryErrorResponse(error: unknown): NextResponse {
  if (error instanceof SessionValidationError) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401, headers: NO_STORE })
  }
  if (error instanceof InventoryForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403, headers: NO_STORE })
  }
  if (error instanceof InventoryNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404, headers: NO_STORE })
  }
  if (error instanceof InventoryConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409, headers: NO_STORE })
  }
  if (error instanceof InventoryValidationError) {
    return NextResponse.json(
      { error: error.message, errors: error.errors },
      { status: 400, headers: NO_STORE },
    )
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: 'Payload inválido.', errors: error.issues },
      { status: 400, headers: NO_STORE },
    )
  }
  return NextResponse.json({ error: 'Erro interno.' }, { status: 500, headers: NO_STORE })
}

export function jsonOk(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function toErrorResponse(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof ApiError) {
    return { status: error.statusCode, body: { error: error.message, details: error.details } }
  }
  return { status: 500, body: { error: 'Erro interno' } }
}

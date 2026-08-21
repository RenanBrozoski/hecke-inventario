export type DiagnosticStatus = 'ok' | 'warning' | 'error' | 'unknown'

export interface DiagnosticCheck {
  key: string
  label: string
  status: DiagnosticStatus
  message: string
}

/** Nunca inclua o valor de um segredo aqui — só presença/formato/comprimento. */
export function check(key: string, label: string, status: DiagnosticStatus, message: string): DiagnosticCheck {
  return { key, label, status, message }
}

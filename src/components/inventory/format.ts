import type { EmploymentType, EquipmentStatus, FieldType, PersonStatus } from './types'

export const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatus, string> = {
  ACTIVE: 'Ativo',
  STOCK: 'Em estoque',
  MAINTENANCE: 'Em manutenção',
  BROKEN: 'Quebrado',
  LOANED: 'Emprestado',
  LOST: 'Roubado / extraviado',
  INACTIVE: 'Inativo / baixado',
}

export const PERSON_STATUS_LABELS: Record<PersonStatus, string> = {
  ACTIVE: 'Ativo',
  ON_LEAVE: 'Afastado',
  TERMINATED: 'Desligado',
}

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  CLT: 'CLT',
  PJ: 'PJ',
  INTERN: 'Estágio',
  TEMPORARY: 'Temporário',
  OTHER: 'Outro',
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  TEXT: 'Texto',
  TEXTAREA: 'Área de texto',
  NUMBER: 'Número',
  DATE: 'Data',
  SELECT: 'Seleção',
  BOOLEAN: 'Sim / não',
  PASSWORD: 'Senha (não migrada)',
  MAC: 'Endereço MAC',
  IP: 'Endereço IP',
  RAM: 'Memória RAM (pentes)',
}

export function statusTone(
  status: EquipmentStatus | PersonStatus,
): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'ACTIVE') return 'success'
  if (status === 'MAINTENANCE' || status === 'LOANED' || status === 'ON_LEAVE') return 'warning'
  if (status === 'BROKEN' || status === 'LOST' || status === 'TERMINATED') return 'danger'
  return 'neutral'
}

export function formatDate(value?: string | null): string {
  if (!value) return '—'
  const dateOnly = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0]
  if (!dateOnly) return value
  const [year, month, day] = dateOnly.split('-')
  return `${day}/${month}/${year}`
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

export function equipmentLabel(item: {
  patrimony?: string | null
  name?: string | null
  id: string
}): string {
  return [item.patrimony, item.name].filter(Boolean).join(' — ') || `#${item.id}`
}

export async function readApiError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  // “Erro interno” não orienta ninguém e não deve virar a mensagem da interface.
  // Erros de regra do negócio continuam vindo da API e são mostrados integralmente.
  if (body?.error && body.error !== 'Erro interno.') return body.error
  if (response.status === 401) return 'Sua sessão expirou. Reabra o inventário pelo Bitrix e tente novamente.'
  if (response.status === 403) return 'Você não tem permissão para concluir esta ação.'
  if (response.status === 404) return 'O registro não foi encontrado. Atualize a página e tente novamente.'
  if (response.status === 409) return 'O registro foi alterado por outra pessoa. Atualize a página antes de tentar novamente.'
  return fallback
}

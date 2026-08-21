const VARIABLE_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g

function readPath(context: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, context)
}

/**
 * Substituição de variáveis `{{caminho.pontilhado}}` por regex sobre um
 * contexto de dados puro — usado por e-mails (item 10) e mapeamentos de
 * integração (item 12). NUNCA `eval`/`Function`/motor de template com
 * código arbitrário. Variável desconhecida ou valor ausente vira string
 * vazia — nunca lança erro, nunca deixa `{{...}}` literal escapar.
 */
export function renderTemplateString(template: string, context: Record<string, unknown>): string {
  return template.replace(VARIABLE_PATTERN, (_match, path: string) => {
    const value = readPath(context, path)
    if (value === undefined || value === null) return ''
    if (Array.isArray(value)) return value.map(String).join(', ')
    return String(value)
  })
}

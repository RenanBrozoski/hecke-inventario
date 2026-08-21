import { resolve } from 'path'

export interface InventoryImportCliOptions {
  file: string
  portalId: string
  mode: 'dry-run' | 'apply'
  allowNewSnapshot: boolean
}

export function inventoryImportUsage(): string {
  return [
    'Uso:',
    '  npm run inventory:import -- --file <export.json> --portal <BitrixPortal.id> --dry-run',
    '  npm run inventory:import -- --file <export.json> --portal <BitrixPortal.id> --apply [--allow-new-snapshot]',
    '',
    'Exatamente um modo (--dry-run ou --apply) é obrigatório. O portal nunca é escolhido automaticamente.',
  ].join('\n')
}

export function parseImportCliArgs(argv: string[]): InventoryImportCliOptions {
  let file: string | undefined
  let portalId: string | undefined
  let dryRun = false
  let apply = false
  let allowNewSnapshot = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (argument === '--help' || argument === '-h') throw new Error(inventoryImportUsage())
    if (argument === '--dry-run') {
      if (dryRun) throw new Error('--dry-run foi informado mais de uma vez.')
      dryRun = true
      continue
    }
    if (argument === '--apply') {
      if (apply) throw new Error('--apply foi informado mais de uma vez.')
      apply = true
      continue
    }
    if (argument === '--allow-new-snapshot') {
      if (allowNewSnapshot) throw new Error('--allow-new-snapshot foi informado mais de uma vez.')
      allowNewSnapshot = true
      continue
    }
    if (argument === '--file' || argument === '--portal') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${argument} exige um valor.`)
      if (argument === '--file') {
        if (file !== undefined) throw new Error('--file foi informado mais de uma vez.')
        file = value
      } else {
        if (portalId !== undefined) throw new Error('--portal foi informado mais de uma vez.')
        portalId = value
      }
      index += 1
      continue
    }
    throw new Error(`Argumento desconhecido: ${argument}.`)
  }

  if (!file) throw new Error('--file é obrigatório.')
  if (!portalId?.trim())
    throw new Error('--portal é obrigatório e deve ser um BitrixPortal.id explícito.')
  if (dryRun === apply) throw new Error('Informe exatamente um modo: --dry-run ou --apply.')
  return {
    file: resolve(file),
    portalId: portalId.trim(),
    mode: dryRun ? 'dry-run' : 'apply',
    allowNewSnapshot,
  }
}

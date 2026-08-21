import 'dotenv/config'
import { readFile, stat } from 'fs/promises'
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { neonConfig } from '@neondatabase/serverless'
import ws from 'ws'
import {
  InventoryImportValidationError,
  prepareInventoryExport,
} from '../src/modules/inventory/import-format'
import {
  InventoryImportSnapshotConflictError,
  InventoryImportTargetConflictError,
  runInventoryImport,
} from '../src/modules/inventory/import-runner'
import { parseImportCliArgs } from '../src/modules/inventory/import-cli'

neonConfig.webSocketConstructor = ws

const MAX_FILE_BYTES = 100 * 1024 * 1024

function createImportPrisma(): PrismaClient {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!connectionString)
    throw new Error('Configure DIRECT_URL (preferencial) ou DATABASE_URL antes de importar.')
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString }) })
}

async function main(): Promise<void> {
  const options = parseImportCliArgs(process.argv.slice(2))
  const fileInfo = await stat(options.file)
  if (!fileInfo.isFile()) throw new Error(`O caminho não é um arquivo: ${options.file}`)
  if (fileInfo.size > MAX_FILE_BYTES)
    throw new Error(`Arquivo maior que o limite de ${MAX_FILE_BYTES} bytes.`)
  const raw = await readFile(options.file)
  const prepared = prepareInventoryExport(raw)
  const prisma = createImportPrisma()
  try {
    const report = await runInventoryImport({
      prisma,
      prepared,
      portalId: options.portalId,
      mode: options.mode,
      allowNewSnapshot: options.allowNewSnapshot,
      executedBy: process.env.USERNAME ?? process.env.USER ?? 'inventory-import-cli',
    })
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  if (error instanceof InventoryImportValidationError) {
    process.stderr.write(
      `${error.message}\n${error.details.map((detail) => `- ${detail}`).join('\n')}\n`,
    )
  } else if (error instanceof InventoryImportTargetConflictError) {
    process.stderr.write(
      `${error.message}\n${error.conflicts.map((detail) => `- ${detail}`).join('\n')}\n`,
    )
  } else if (error instanceof InventoryImportSnapshotConflictError) {
    process.stderr.write(`${error.message}\n`)
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  }
  process.exitCode = 1
})

/**
 * Importação direta da planilha "Endereços de rede Hecke" para o banco de dados.
 * Uso: npx tsx --env-file .env.local scripts/import-excel.ts <caminho-do-xlsx>
 *
 * Apaga todos os dados de equipamentos e colaboradores do portal ativo, depois
 * importa as abas: Desktops 2.0, Notebooks 2.0, Monitores 2.0, Smartphone,
 * Coletores e Rádios.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

neonConfig.webSocketConstructor = ws

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKIP_HOLDER = new Set([
  'reserva/sem uso', 'reserva', 'sem uso', 'estoque', 'parado', 'parada',
  'descartado', 'descartada', 'inativo', 'inativa', 'n/a', '-', '',
])

function normHolder(val: unknown): string | null {
  if (val == null) return null
  const s = String(val).trim()
  if (SKIP_HOLDER.has(s.toLowerCase())) return null
  return s
}

function str(val: unknown): string | null {
  if (val == null) return null
  const s = String(val).trim()
  return s || null
}

function excelDate(val: unknown): Date | null {
  if (val == null) return null
  if (val instanceof Date) return val
  if (typeof val === 'number') return new Date(Math.round((val - 25569) * 86400_000))
  return null
}

function dateOnly(val: unknown): Date | null {
  const d = excelDate(val)
  if (!d || isNaN(d.getTime())) return null
  return d
}

function rows(wb: XLSX.WorkBook, sheetName: string): unknown[][] {
  const ws = wb.Sheets[sheetName]
  if (!ws) { console.warn(`  Aba "${sheetName}" não encontrada.`); return [] }
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })
}

function matchesCode(val: unknown, prefix: RegExp): boolean {
  return !!val && prefix.test(String(val).trim())
}

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

function createPrisma(): PrismaClient {
  const cs = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!cs) throw new Error('DIRECT_URL ou DATABASE_URL não configurado. Use --env-file .env.local')
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: cs }) })
}

// ---------------------------------------------------------------------------
// Limpar inventário
// ---------------------------------------------------------------------------

async function clearInventory(prisma: PrismaClient, portalId: string): Promise<void> {
  console.log('  Limpando dados...')
  // Ordem: folhas antes das raízes (FK constraints)
  await prisma.collectorCommand.deleteMany({ where: { portalId } })
  await prisma.inventoryMovement.deleteMany({ where: { portalId } })
  await prisma.inventoryTerm.deleteMany({ where: { portalId } })
  await prisma.inventoryCorporateLineHistory.deleteMany({ where: { portalId } })
  await prisma.inventoryCorporateLine.deleteMany({ where: { portalId } })
  await prisma.inventoryAttachment.deleteMany({ where: { portalId } })
  await prisma.inventoryBlobCleanup.deleteMany({ where: { portalId } })
  await prisma.inventoryImportRun.deleteMany({ where: { portalId } })
  await prisma.inventoryEquipment.deleteMany({ where: { portalId } })
  await prisma.inventoryPerson.deleteMany({ where: { portalId } })
  console.log('  ✓ Dados limpos.')
}

// ---------------------------------------------------------------------------
// Caches (dedup)
// ---------------------------------------------------------------------------

async function ensureCategory(
  prisma: PrismaClient,
  portalId: string,
  name: string,
  prefix: string | null,
  cache: Map<string, string>,
): Promise<string> {
  if (cache.has(name)) return cache.get(name)!
  const existing = await prisma.inventoryCategory.findFirst({ where: { portalId, name } })
  if (existing) { cache.set(name, existing.id); return existing.id }
  const created = await prisma.inventoryCategory.create({
    data: { portalId, name, prefix, icon: 'box-seam', active: true, revision: 1 },
  })
  cache.set(name, created.id)
  return created.id
}

async function ensureDept(
  prisma: PrismaClient,
  portalId: string,
  name: string | null,
  cache: Map<string, string>,
): Promise<string | null> {
  if (!name) return null
  if (cache.has(name)) return cache.get(name)!
  const existing = await prisma.inventoryDepartment.findFirst({ where: { portalId, name } })
  if (existing) { cache.set(name, existing.id); return existing.id }
  const created = await prisma.inventoryDepartment.create({ data: { portalId, name, active: true } })
  cache.set(name, created.id)
  return created.id
}

async function ensurePerson(
  prisma: PrismaClient,
  portalId: string,
  name: string,
  deptId: string | null,
  cache: Map<string, string>,
): Promise<string> {
  const key = name.toLowerCase()
  if (cache.has(key)) return cache.get(key)!
  const existing = await prisma.inventoryPerson.findFirst({ where: { portalId, name } })
  if (existing) { cache.set(key, existing.id); return existing.id }
  const created = await prisma.inventoryPerson.create({
    data: { portalId, name, departmentId: deptId, status: 'ACTIVE' },
  })
  cache.set(key, created.id)
  return created.id
}

// ---------------------------------------------------------------------------
// Importadores por aba
// ---------------------------------------------------------------------------

async function importDesktops(
  wb: XLSX.WorkBook,
  prisma: PrismaClient,
  portalId: string,
  catId: string,
  cats: Map<string, string>,
  depts: Map<string, string>,
  people: Map<string, string>,
): Promise<number> {
  // Cols: 0=PC, 1=TAG, 2=SETOR, 3=Colaboradores, 4=Recbto, 5=Ent,
  //       6=Windows, 7=PlacaMãe, 8=PlacaVídeo, 9=Proc, 10=RAM, 11=HD/SSD,
  //       12=Antivírus, 13=CCCleaner, 14=IP, 15=MAC(cabo), 16=MAC(wifi),
  //       17=IPFixo, 18=Credencial, 19=Obs
  const data = rows(wb, 'Desktops 2.0')
  let count = 0
  for (const row of data) {
    if (!matchesCode(row[0], /^PC\d+/i)) continue
    const patrimony = str(row[0])!
    const dept = str(row[2])
    const holderName = normHolder(row[3])
    const deptId = await ensureDept(prisma, portalId, dept, depts)
    const holderId = holderName ? await ensurePerson(prisma, portalId, holderName, deptId, people) : null
    const specs: Record<string, string> = {}
    if (str(row[6])) specs.windows = str(row[6])!
    if (str(row[7])) specs.placa_mae = str(row[7])!
    if (str(row[8])) specs.placa_video = str(row[8])!
    if (str(row[9])) specs.processador = str(row[9])!
    if (str(row[10])) specs.ram = str(row[10])!
    if (str(row[11])) specs.hd_ssd = str(row[11])!
    if (str(row[12])) specs.antivirus = str(row[12])!
    if (str(row[14])) specs.ip_address = str(row[14])!
    if (str(row[15])) specs.mac_cabo = str(row[15])!
    if (str(row[16])) specs.mac_wifi = str(row[16])!
    if (str(row[17])) specs.ip_fixo = str(row[17])!
    if (str(row[18])) specs.credencial_rede = str(row[18])!
    await prisma.inventoryEquipment.create({
      data: {
        portalId,
        patrimony,
        assetTag: str(row[1]),
        categoryId: catId,
        currentHolderId: holderId,
        departmentId: deptId,
        status: 'ACTIVE',
        receivedAt: dateOnly(row[4]),
        deliveredAt: dateOnly(row[5]),
        notes: str(row[19]),
        specs,
      },
    })
    count++
  }
  console.log(`  Desktop: ${count} equipamentos`)
  return count
}

async function importNotebooks(
  wb: XLSX.WorkBook,
  prisma: PrismaClient,
  portalId: string,
  catId: string,
  cats: Map<string, string>,
  depts: Map<string, string>,
  people: Map<string, string>,
): Promise<number> {
  const data = rows(wb, 'Notebooks 2.0')
  let count = 0
  for (const row of data) {
    if (!matchesCode(row[1], /^NB\d+/i)) continue
    const patrimony = str(row[1])!
    const dept = str(row[4])
    const holderName = normHolder(row[5])
    const deptId = await ensureDept(prisma, portalId, dept, depts)
    const holderId = holderName ? await ensurePerson(prisma, portalId, holderName, deptId, people) : null
    const specs: Record<string, string> = {}
    if (str(row[10])) specs.windows = str(row[10])!
    if (str(row[11])) specs.modelo = str(row[11])!
    if (str(row[13])) specs.placa_mae = str(row[13])!
    if (str(row[14])) specs.placa_video = str(row[14])!
    if (str(row[15])) specs.processador = str(row[15])!
    if (str(row[16])) specs.ram = str(row[16])!
    if (str(row[17])) specs.hd_ssd = str(row[17])!
    if (str(row[18])) specs.antivirus = str(row[18])!
    if (str(row[20])) specs.ip_address = str(row[20])!
    if (str(row[21])) specs.mac_cabo = str(row[21])!
    if (str(row[22])) specs.mac_wifi = str(row[22])!
    if (str(row[23])) specs.ip_fixo = str(row[23])!
    if (str(row[24])) specs.credencial_rede = str(row[24])!
    if (str(row[9])) specs.tem_adaptador = str(row[9])!
    await prisma.inventoryEquipment.create({
      data: {
        portalId,
        patrimony,
        assetTag: str(row[2]),
        invoiceNumber: str(row[3]),
        name: str(row[11]),
        serialNumber: str(row[12]),
        categoryId: catId,
        currentHolderId: holderId,
        departmentId: deptId,
        status: 'ACTIVE',
        receivedAt: dateOnly(row[6]),
        deliveredAt: dateOnly(row[7]),
        notes: str(row[25]),
        specs,
      },
    })
    count++
  }
  console.log(`  Notebook: ${count} equipamentos`)
  return count
}

async function importMonitores(
  wb: XLSX.WorkBook,
  prisma: PrismaClient,
  portalId: string,
  catId: string,
  depts: Map<string, string>,
  people: Map<string, string>,
): Promise<number> {
  // Cols: 0=MONITOR, 1=TAG, 2=SETOR, 3=Colaboradores, 4=Recbto, 5=Ent,
  //       6=Modelo, 7=NºSérie, 8=Obs
  const data = rows(wb, 'Monitores 2.0')
  let count = 0
  for (const row of data) {
    if (!matchesCode(row[0], /^MN\d+/i)) continue
    const patrimony = str(row[0])!
    const dept = str(row[2])
    const holderName = normHolder(row[3])
    const deptId = await ensureDept(prisma, portalId, dept, depts)
    const holderId = holderName ? await ensurePerson(prisma, portalId, holderName, deptId, people) : null
    await prisma.inventoryEquipment.create({
      data: {
        portalId,
        patrimony,
        assetTag: str(row[1]),
        name: str(row[6]),
        serialNumber: str(row[7]),
        categoryId: catId,
        currentHolderId: holderId,
        departmentId: deptId,
        status: 'ACTIVE',
        receivedAt: dateOnly(row[4]),
        deliveredAt: dateOnly(row[5]),
        notes: str(row[8]),
        specs: {},
      },
    })
    count++
  }
  console.log(`  Monitor: ${count} equipamentos`)
  return count
}

async function importSmartphones(
  wb: XLSX.WorkBook,
  prisma: PrismaClient,
  portalId: string,
  catId: string,
  depts: Map<string, string>,
  people: Map<string, string>,
): Promise<number> {
  // Cols: 0=SM, 1=TAG, 2=NF, 3=Setor, 4=Colaboradores, 5=Recbto, 6=Ent,
  //       7=TERMO, 8=Modelo, 9=NumModelo, 10=NºSérie, 11=Memoria, 12=RAM,
  //       13=IMEI1, 14=IMEI2, 15=Tel1, 16=Tel2, 17=Tel3, 18=MAC,
  //       19=SerieCarregador, 20=EmailVinculado, 21=Senha, 22=EmailUsuário,
  //       23=LoginCigam, 24=Obs
  const data = rows(wb, 'Smartphone')
  let count = 0
  for (const row of data) {
    if (!matchesCode(row[0], /^SM\d+/i)) continue
    const patrimony = str(row[0])!
    const dept = str(row[3])
    const holderName = normHolder(row[4])
    const deptId = await ensureDept(prisma, portalId, dept, depts)
    const holderId = holderName ? await ensurePerson(prisma, portalId, holderName, deptId, people) : null
    const specs: Record<string, string> = {}
    if (str(row[8])) specs.modelo = str(row[8])!
    if (str(row[9])) specs.numero_modelo = str(row[9])!
    if (str(row[11])) specs.memoria = str(row[11])!
    if (str(row[12])) specs.ram = str(row[12])!
    if (row[13] != null) specs.imei1 = String(row[13])
    if (row[14] != null) specs.imei2 = String(row[14])
    if (str(row[15])) specs.telefone1 = str(row[15])!
    if (str(row[16])) specs.telefone2 = str(row[16])!
    if (str(row[17])) specs.telefone3 = str(row[17])!
    if (str(row[18])) specs.mac = str(row[18])!
    if (str(row[20])) specs.email_vinculado = str(row[20])!
    if (str(row[22])) specs.email_usuario = str(row[22])!
    if (str(row[23])) specs.login_cigam = str(row[23])!
    await prisma.inventoryEquipment.create({
      data: {
        portalId,
        patrimony,
        assetTag: str(row[1]),
        invoiceNumber: str(row[2]),
        name: str(row[8]),
        serialNumber: str(row[10]),
        categoryId: catId,
        currentHolderId: holderId,
        departmentId: deptId,
        status: 'ACTIVE',
        receivedAt: dateOnly(row[5]),
        deliveredAt: dateOnly(row[6]),
        notes: str(row[24]),
        specs,
      },
    })
    count++
  }
  console.log(`  Smartphone: ${count} equipamentos`)
  return count
}

async function importColetores(
  wb: XLSX.WorkBook,
  prisma: PrismaClient,
  portalId: string,
  catId: string,
): Promise<number> {
  // Cols: 0=CTR, 1=MODELO, 2=IMEI1, 3=IMEI2, 4=ID DISPOSITIVO, 5=MAC
  // (sem linha vazia inicial — header está na linha 0, dados na linha 1+)
  const data = rows(wb, 'Coletores')
  let count = 0
  for (const row of data) {
    if (!matchesCode(row[0], /^CTR\d+/i)) continue
    const specs: Record<string, string> = {}
    if (str(row[1])) specs.modelo = str(row[1])!
    if (row[2] != null) specs.imei1 = String(row[2])
    if (row[3] != null) specs.imei2 = String(row[3])
    if (str(row[4])) specs.id_dispositivo = str(row[4])!
    if (str(row[5])) specs.mac = str(row[5])!
    await prisma.inventoryEquipment.create({
      data: {
        portalId,
        patrimony: str(row[0])!,
        name: str(row[1]),
        categoryId: catId,
        status: 'ACTIVE',
        specs,
      },
    })
    count++
  }
  console.log(`  Coletor: ${count} equipamentos`)
  return count
}

async function importRadios(
  wb: XLSX.WorkBook,
  prisma: PrismaClient,
  portalId: string,
  catId: string,
  depts: Map<string, string>,
  people: Map<string, string>,
): Promise<number> {
  // Cols: 0=RC, 1=MODELO, 2=USUÁRIO
  // (linha vazia em row[0], header em row[1], dados em row[2]+)
  const radioSheet = wb.SheetNames.find((n) => n.toLowerCase().includes('dio'))
  if (!radioSheet) { console.warn('  Aba Rádios não encontrada.'); return 0 }
  const data = rows(wb, radioSheet)
  let count = 0
  for (const row of data) {
    if (!matchesCode(row[0], /^RC\d+/i)) continue
    const holderName = normHolder(row[2])
    const holderId = holderName ? await ensurePerson(prisma, portalId, holderName, null, people) : null
    const specs: Record<string, string> = {}
    if (str(row[1])) specs.modelo = str(row[1])!
    await prisma.inventoryEquipment.create({
      data: {
        portalId,
        patrimony: str(row[0])!,
        name: str(row[1]),
        categoryId: catId,
        currentHolderId: holderId,
        status: 'ACTIVE',
        specs,
      },
    })
    count++
  }
  console.log(`  Rádio: ${count} equipamentos`)
  return count
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const excelPath = process.argv[2] ?? 'C:/Users/Hecke/Downloads/Endereços de rede Hecke (7).xlsx'
  console.log(`\nLendo: ${path.resolve(excelPath)}\n`)

  const wb = XLSX.readFile(excelPath)
  const prisma = createPrisma()

  try {
    // Encontra o portal ativo
    const portal = await prisma.bitrixPortal.findFirst({
      where: { status: 'ACTIVE' },
      select: { id: true, domain: true },
    })
    if (!portal) throw new Error('Nenhum portal ativo encontrado no banco.')
    console.log(`Portal: ${portal.domain} (${portal.id})\n`)

    // Limpa
    await clearInventory(prisma, portal.id)
    console.log()

    // Caches
    const cats = new Map<string, string>()
    const depts = new Map<string, string>()
    const people = new Map<string, string>()

    // Categorias
    const catDesktop = await ensureCategory(prisma, portal.id, 'Desktop', 'PC', cats)
    const catNotebook = await ensureCategory(prisma, portal.id, 'Notebook', 'NB', cats)
    const catMonitor = await ensureCategory(prisma, portal.id, 'Monitor', 'MN', cats)
    const catSmartphone = await ensureCategory(prisma, portal.id, 'Smartphone', 'SM', cats)
    const catColetor = await ensureCategory(prisma, portal.id, 'Coletor', 'CTR', cats)
    const catRadio = await ensureCategory(prisma, portal.id, 'Rádio', 'RC', cats)

    console.log('Importando...')
    let total = 0
    total += await importDesktops(wb, prisma, portal.id, catDesktop, cats, depts, people)
    total += await importNotebooks(wb, prisma, portal.id, catNotebook, cats, depts, people)
    total += await importMonitores(wb, prisma, portal.id, catMonitor, depts, people)
    total += await importSmartphones(wb, prisma, portal.id, catSmartphone, depts, people)
    total += await importColetores(wb, prisma, portal.id, catColetor)
    total += await importRadios(wb, prisma, portal.id, catRadio, depts, people)

    console.log(`\n✓ Total: ${total} equipamentos, ${people.size} colaboradores, ${depts.size} setores`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err: unknown) => {
  console.error('\n✗ Erro:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})

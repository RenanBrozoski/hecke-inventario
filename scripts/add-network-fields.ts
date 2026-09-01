/**
 * Adiciona campos de categoria para equipamentos de rede (Servidor, Impressora,
 * Roteador/Wi-Fi, Switch, Leitor Facial, TV, Segurança, Tablet).
 * Campos com listVisible=true aparecem como colunas na lista ao filtrar por categoria.
 * Campos já existentes são ignorados.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

neonConfig.webSocketConstructor = ws

function createPrisma(): PrismaClient {
  const cs = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!cs) throw new Error('DIRECT_URL ou DATABASE_URL não configurado.')
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: cs }) })
}

// Campos por categoria. Cada entrada: [key, label, type, listVisible, sortOrder]
type FieldDef = [string, string, string, boolean, number]

const FIELDS_BY_CATEGORY: Record<string, FieldDef[]> = {
  'Servidor': [
    ['ip_address', 'Endereço IP', 'TEXT', true, 0],
    ['modelo', 'Modelo', 'TEXT', true, 1],
    ['login', 'Login', 'TEXT', false, 2],
    ['acesso', 'Acesso', 'TEXT', false, 3],
  ],
  'Impressora': [
    ['ip_address', 'Endereço IP', 'TEXT', true, 0],
    ['modelo', 'Modelo', 'TEXT', true, 1],
    ['login', 'Login', 'TEXT', false, 2],
    ['acesso', 'Acesso', 'TEXT', false, 3],
  ],
  'Roteador/Wi-Fi': [
    ['ip_address', 'Endereço IP', 'TEXT', true, 0],
    ['modelo', 'Modelo', 'TEXT', true, 1],
    ['login', 'Login', 'TEXT', false, 2],
    ['acesso', 'Acesso', 'TEXT', false, 3],
    ['mac_cabo', 'MAC (Cabo)', 'TEXT', false, 4],
    ['mac_wifi', 'MAC (Wi-Fi)', 'TEXT', false, 5],
  ],
  'Switch': [
    ['ip_address', 'Endereço IP', 'TEXT', true, 0],
    ['modelo', 'Modelo', 'TEXT', true, 1],
    ['login', 'Login', 'TEXT', false, 2],
    ['acesso', 'Acesso', 'TEXT', false, 3],
    ['mac_cabo', 'MAC (Cabo)', 'TEXT', false, 4],
  ],
  'Leitor Facial': [
    ['ip_address', 'Endereço IP', 'TEXT', true, 0],
    ['modelo', 'Modelo', 'TEXT', true, 1],
    ['login', 'Login', 'TEXT', false, 2],
    ['acesso', 'Acesso', 'TEXT', false, 3],
  ],
  'TV': [
    ['ip_address', 'Endereço IP', 'TEXT', false, 0],
    ['modelo', 'Modelo', 'TEXT', true, 1],
  ],
  'Segurança': [
    ['ip_address', 'Endereço IP', 'TEXT', false, 0],
    ['modelo', 'Modelo', 'TEXT', true, 1],
    ['acesso', 'Acesso', 'TEXT', false, 2],
  ],
  'Tablet': [
    ['modelo', 'Modelo', 'TEXT', true, 0],
    ['imei1', 'IMEI 1', 'TEXT', false, 1],
    ['imei2', 'IMEI 2', 'TEXT', false, 2],
    ['mac_wifi', 'MAC (Wi-Fi)', 'TEXT', false, 3],
    ['email_vinculado', 'E-mail vinculado', 'TEXT', false, 4],
    ['pim', 'PIM', 'TEXT', false, 5],
  ],
}

async function main() {
  const prisma = createPrisma()
  try {
    const portal = await prisma.bitrixPortal.findFirst({
      where: { status: 'ACTIVE' },
      select: { id: true, domain: true },
    })
    if (!portal) throw new Error('Nenhum portal ativo encontrado.')
    console.log(`Portal: ${portal.domain}\n`)

    const categories = await prisma.inventoryCategory.findMany({
      where: { portalId: portal.id, name: { in: Object.keys(FIELDS_BY_CATEGORY) } },
      include: { fields: { select: { key: true } } },
    })

    for (const cat of categories) {
      const defs = FIELDS_BY_CATEGORY[cat.name]
      if (!defs) continue
      const existingKeys = new Set(cat.fields.map((f) => f.key))
      const toAdd = defs.filter(([key]) => !existingKeys.has(key))
      if (toAdd.length === 0) {
        console.log(`  ${cat.name}: sem novos campos`)
        continue
      }
      for (const [key, label, type, listVisible, sortOrder] of toAdd) {
        await prisma.inventoryField.create({
          data: {
            portalId: portal.id,
            categoryId: cat.id,
            key,
            label,
            type: type as never,
            listVisible,
            sortOrder,
            active: true,
            required: false,
            options: [],
          },
        })
        console.log(`  ${cat.name}: + ${label} (listVisible=${listVisible})`)
      }
    }
    console.log('\n✓ Concluído.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err: unknown) => {
  console.error('\n✗ Erro:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})

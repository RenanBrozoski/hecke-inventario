import { NextResponse } from 'next/server'
import { inventoryErrorResponse, requireInventoryContext, requireInventoryRole, InventoryValidationError } from '@/src/modules/inventory/http'
import { confirmSpreadsheetImport, type ImportConflictStrategy } from '@/src/modules/inventory/spreadsheet-import-service'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const form = await request.formData()
    const file = form.get('file')
    const strategy = form.get('strategy')
    if (!(file instanceof File) || !/\.(xlsx|csv)$/i.test(file.name)) throw new InventoryValidationError('Envie novamente uma planilha XLSX ou CSV.')
    if (file.size === 0 || file.size > 10 * 1024 * 1024) throw new InventoryValidationError('A planilha deve ter entre 1 byte e 10 MB.')
    if (strategy !== 'ignore' && strategy !== 'update' && strategy !== 'review') throw new InventoryValidationError('Estratégia de conflito inválida.')
    const report = await confirmSpreadsheetImport(context, new Uint8Array(await file.arrayBuffer()), file.name, strategy as ImportConflictStrategy)
    return NextResponse.json({ report })
  } catch (error) { return inventoryErrorResponse(error) }
}

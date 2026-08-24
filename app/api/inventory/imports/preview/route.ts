import { NextResponse } from 'next/server'
import { inventoryErrorResponse, requireInventoryContext, requireInventoryRole, InventoryValidationError } from '@/src/modules/inventory/http'
import { previewSpreadsheetImport } from '@/src/modules/inventory/spreadsheet-import-service'

export const runtime = 'nodejs'

async function fileFrom(request: Request) {
  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new InventoryValidationError('Selecione uma planilha XLSX ou CSV.')
  if (file.size === 0 || file.size > 10 * 1024 * 1024) throw new InventoryValidationError('A planilha deve ter entre 1 byte e 10 MB.')
  if (!/\.(xlsx|csv)$/i.test(file.name)) throw new InventoryValidationError('Envie um arquivo XLSX ou CSV.')
  return file
}

export async function POST(request: Request) {
  try {
    const context = await requireInventoryContext(request)
    requireInventoryRole(context, 'ADMIN')
    const file = await fileFrom(request)
    const preview = await previewSpreadsheetImport(context.portalId, new Uint8Array(await file.arrayBuffer()), file.name)
    return NextResponse.json({ preview })
  } catch (error) { return inventoryErrorResponse(error) }
}

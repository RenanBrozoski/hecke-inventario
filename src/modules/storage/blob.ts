import { put, del, list } from '@vercel/blob'

export interface UploadResult {
  url: string
  pathname: string
  contentType: string | undefined
}

export interface UploadOptions {
  contentType?: string
  addRandomSuffix?: boolean
}

/**
 * NOTA DE SEGURANÇA (revisitar quando os anexos de solicitação forem implementados):
 * o Vercel Blob, hoje, só oferece acesso "public" (URL não listável, mas não
 * autenticada). O controle de "quem pode baixar este arquivo" precisa continuar
 * sendo feito na nossa própria camada de permissões antes de entregar a URL ao
 * cliente — a URL em si não é uma barreira de acesso.
 */
export async function uploadFile(
  pathname: string,
  file: Buffer | Blob | ReadableStream,
  options?: UploadOptions,
): Promise<UploadResult> {
  const blob = await put(pathname, file, {
    access: 'public',
    contentType: options?.contentType,
    addRandomSuffix: options?.addRandomSuffix ?? true,
  })

  return {
    url: blob.url,
    pathname: blob.pathname,
    contentType: blob.contentType,
  }
}

export async function deleteFile(url: string): Promise<void> {
  await del(url)
}

export async function listFiles(prefix?: string) {
  return list({ prefix })
}

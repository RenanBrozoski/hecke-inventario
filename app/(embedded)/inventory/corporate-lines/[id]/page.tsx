import { CorporateLineDetailPage } from '@/src/components/inventory/CorporateLinesPages'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CorporateLineDetailPage lineId={id} />
}

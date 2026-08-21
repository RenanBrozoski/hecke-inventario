'use client'

import { useParams } from 'next/navigation'
import { PersonDetailPage } from '@/src/components/inventory/PersonDetailPage'
import { SessionGate } from '@/src/components/session/SessionGate'

export default function InventoryPersonDetailPage() {
  const params = useParams<{ id: string }>()
  return <SessionGate>{() => <PersonDetailPage personId={params.id} />}</SessionGate>
}

'use client'

import { useParams } from 'next/navigation'
import { TermoPage } from '@/src/components/inventory/TermoPage'
import { SessionGate } from '@/src/components/session/SessionGate'

export default function InventoryPersonTermoPage() {
  const params = useParams<{ id: string }>()
  return <SessionGate>{() => <TermoPage personId={params.id} />}</SessionGate>
}

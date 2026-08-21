'use client'

import { useParams } from 'next/navigation'
import { PersonFormPage } from '@/src/components/inventory/PersonFormPage'
import { SessionGate } from '@/src/components/session/SessionGate'

export default function EditInventoryPersonPage() {
  const params = useParams<{ id: string }>()
  return <SessionGate>{() => <PersonFormPage personId={params.id} />}</SessionGate>
}

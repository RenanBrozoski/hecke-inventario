'use client'

import { useParams } from 'next/navigation'
import { EquipmentFormPage } from '@/src/components/inventory/EquipmentFormPage'
import { SessionGate } from '@/src/components/session/SessionGate'

export default function EditInventoryEquipmentPage() {
  const params = useParams<{ id: string }>()
  return <SessionGate>{() => <EquipmentFormPage equipmentId={params.id} />}</SessionGate>
}

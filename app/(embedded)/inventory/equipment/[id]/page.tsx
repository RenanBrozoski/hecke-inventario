'use client'

import { useParams } from 'next/navigation'
import { EquipmentDetailPage } from '@/src/components/inventory/EquipmentDetailPage'
import { SessionGate } from '@/src/components/session/SessionGate'

export default function InventoryEquipmentDetailPage() {
  const params = useParams<{ id: string }>()
  return <SessionGate>{() => <EquipmentDetailPage equipmentId={params.id} />}</SessionGate>
}

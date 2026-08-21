'use client'

import { EquipmentListPage } from '@/src/components/inventory/EquipmentListPage'
import { SessionGate } from '@/src/components/session/SessionGate'

export default function InventoryEquipmentPage() {
  return <SessionGate>{() => <EquipmentListPage />}</SessionGate>
}

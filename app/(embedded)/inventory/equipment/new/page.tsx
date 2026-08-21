'use client'

import { EquipmentFormPage } from '@/src/components/inventory/EquipmentFormPage'
import { SessionGate } from '@/src/components/session/SessionGate'

export default function NewInventoryEquipmentPage() {
  return <SessionGate>{() => <EquipmentFormPage />}</SessionGate>
}


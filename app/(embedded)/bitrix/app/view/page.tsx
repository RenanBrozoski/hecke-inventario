'use client'

import { SessionGate } from '@/src/components/session/SessionGate'
import { InventoryDashboardPage } from '@/src/components/inventory/InventoryDashboardPage'

export default function BitrixAppPage() {
  return <SessionGate>{() => <InventoryDashboardPage />}</SessionGate>
}

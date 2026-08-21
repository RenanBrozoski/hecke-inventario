'use client'

import { InventoryDashboardPage } from '@/src/components/inventory/InventoryDashboardPage'
import { SessionGate } from '@/src/components/session/SessionGate'

export default function InventoryPage() {
  return <SessionGate>{() => <InventoryDashboardPage />}</SessionGate>
}

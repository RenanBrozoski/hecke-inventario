'use client'

import { DedupePage } from '@/src/components/inventory/DedupePage'
import { SessionGate } from '@/src/components/session/SessionGate'

export default function InventoryDedupePage() {
  return <SessionGate>{() => <DedupePage />}</SessionGate>
}

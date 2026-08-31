'use client'

import { AgentFleetPage } from '@/src/components/inventory/AgentFleetPage'
import { SessionGate } from '@/src/components/session/SessionGate'

export default function InventoryAgentsRoute() {
  return <SessionGate>{() => <AgentFleetPage />}</SessionGate>
}

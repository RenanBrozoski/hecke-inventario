'use client'

import { PeopleListPage } from '@/src/components/inventory/PeopleListPage'
import { SessionGate } from '@/src/components/session/SessionGate'

export default function InventoryPeoplePage() {
  return <SessionGate>{() => <PeopleListPage />}</SessionGate>
}

'use client'

import { PersonFormPage } from '@/src/components/inventory/PersonFormPage'
import { SessionGate } from '@/src/components/session/SessionGate'

export default function NewInventoryPersonPage() {
  return <SessionGate>{() => <PersonFormPage />}</SessionGate>
}


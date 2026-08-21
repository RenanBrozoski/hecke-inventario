'use client'
import { InventorySettingsPage } from '@/src/components/inventory/InventorySettingsPage'
import { SessionGate } from '@/src/components/session/SessionGate'
export default function InventorySettingsRoute() { return <SessionGate>{() => <InventorySettingsPage />}</SessionGate> }

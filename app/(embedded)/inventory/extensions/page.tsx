'use client'
import { ExtensionsPage } from '@/src/components/inventory/LedgerPages'
import { SessionGate } from '@/src/components/session/SessionGate'
export default function InventoryExtensionsPage() { return <SessionGate>{() => <ExtensionsPage />}</SessionGate> }


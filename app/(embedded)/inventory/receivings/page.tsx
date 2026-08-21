'use client'
import { ReceivingsPage } from '@/src/components/inventory/LedgerPages'
import { SessionGate } from '@/src/components/session/SessionGate'
export default function InventoryReceivingsPage() { return <SessionGate>{() => <ReceivingsPage />}</SessionGate> }

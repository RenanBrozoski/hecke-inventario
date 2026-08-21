'use client'
import { TermsPage } from '@/src/components/inventory/TermsPages'
import { SessionGate } from '@/src/components/session/SessionGate'
export default function InventoryTermsPage() { return <SessionGate>{() => <TermsPage />}</SessionGate> }


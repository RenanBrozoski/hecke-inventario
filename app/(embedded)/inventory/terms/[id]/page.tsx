'use client'
import { useParams } from 'next/navigation'
import { TermDetailPage } from '@/src/components/inventory/TermsPages'
import { SessionGate } from '@/src/components/session/SessionGate'
export default function InventoryTermDetailPage() { const params = useParams<{ id: string }>(); return <SessionGate>{() => <TermDetailPage termId={params.id} />}</SessionGate> }

'use client'
import { useParams } from 'next/navigation'
import { CustomModuleRecordsPage } from '@/src/components/inventory/CustomModulesPages'
import { SessionGate } from '@/src/components/session/SessionGate'
export default function InventoryCustomModulePage() { const params = useParams<{ id: string }>(); return <SessionGate>{() => <CustomModuleRecordsPage moduleId={params.id} />}</SessionGate> }

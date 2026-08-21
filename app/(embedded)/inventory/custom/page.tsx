'use client'
import { CustomModulesPage } from '@/src/components/inventory/CustomModulesPages'
import { SessionGate } from '@/src/components/session/SessionGate'
export default function InventoryCustomPage() { return <SessionGate>{() => <CustomModulesPage />}</SessionGate> }


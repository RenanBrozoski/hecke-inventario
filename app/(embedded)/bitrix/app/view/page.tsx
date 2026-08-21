'use client'

import { SessionGate } from '@/src/components/session/SessionGate'
import { DashboardContent } from './DashboardContent'

export default function BitrixAppPage() {
  return <SessionGate>{(me) => <DashboardContent me={me} />}</SessionGate>
}

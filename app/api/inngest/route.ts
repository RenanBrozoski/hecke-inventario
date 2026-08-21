import { serve } from 'inngest/next'
import { inngest } from '@/src/lib/inngest/client'
import { syncBitrixPortalJob } from '@/src/inngest/functions/sync-bitrix-portal'
import { cleanupHandshakesJob } from '@/src/inngest/functions/cleanup-handshakes'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [syncBitrixPortalJob, cleanupHandshakesJob],
})

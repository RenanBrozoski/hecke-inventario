import { inngest } from '@/src/lib/inngest/client'
import { cleanupExpiredHandshakes } from '@/src/modules/auth/handshake'

/** Limpeza periódica de handshakes expirados/consumidos — roda a cada 15 minutos. */
export const cleanupHandshakesJob = inngest.createFunction(
  { id: 'cleanup-expired-handshakes' },
  { cron: '*/15 * * * *' },
  async () => {
    const deleted = await cleanupExpiredHandshakes()
    return { deleted }
  },
)

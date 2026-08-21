import { inngest } from '@/src/lib/inngest/client'
import { prisma } from '@/src/lib/prisma'
import { syncPortalUsersAndDepartments } from '@/src/modules/bitrix/sync'

/**
 * Dispara a sincronização de usuários/departamentos de um portal. O endpoint
 * HTTP que envia este evento (install, ou o trigger manual do admin) só
 * dispara e responde — quem processa de fato é este job, em segundo plano.
 * Idempotência: cada execução recebe uma linha própria em JobExecution
 * (chave = portalId + id do evento), com retry automático do Inngest (2x) só
 * em falha — o resultado gravado é só contagens/erro resumido, nunca payload
 * de usuário/departamento.
 */
export const syncBitrixPortalJob = inngest.createFunction(
  { id: 'bitrix-sync-users-departments', retries: 2 },
  { event: 'bitrix/portal.sync.requested' },
  async ({ event, step }) => {
    const portalId = event.data.portalId as string
    const idempotencyKey = `bitrix-sync:${portalId}:${event.id}`

    await step.run('register-attempt', () =>
      prisma.jobExecution.upsert({
        where: { idempotencyKey },
        create: {
          idempotencyKey,
          jobType: 'bitrix-sync',
          status: 'PENDING',
          attempts: 1,
          lastAttemptAt: new Date(),
        },
        update: { attempts: { increment: 1 }, lastAttemptAt: new Date(), status: 'PENDING' },
      }),
    )

    try {
      const result = await step.run('sync', () => syncPortalUsersAndDepartments(portalId))

      await step.run('mark-success', () =>
        prisma.jobExecution.update({
          where: { idempotencyKey },
          data: { status: 'SUCCESS', result },
        }),
      )

      return result
    } catch (error) {
      await step.run('mark-failed', () =>
        prisma.jobExecution.update({
          where: { idempotencyKey },
          data: {
            status: 'FAILED',
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        }),
      )
      throw error
    }
  },
)

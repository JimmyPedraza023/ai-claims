
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_EVENTS } from '../audit/event-types';
import { ClaimedJob, PermanentJobError } from '../jobs/job-queue';
import { EMAIL_SENDER, EmailError } from './email-sender';
import type { EmailSender } from './email-sender';
import { NotificationsRepository } from './notifications.repository';
import { isFinalFailure } from '../jobs/job-queue';


// modules/notifications/send-notification.handler.ts
@Injectable()
export class SendNotificationHandler {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsRepository,
    private readonly audit: AuditService,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
  ) {}

  /** El correo se envía SIN transacción abierta (igual que la llamada al modelo). */
  async execute(job: ClaimedJob): Promise<void> {
    if (!job.notificationId) throw new PermanentJobError('El trabajo no trae aviso');
    const n = await this.notifications.findById(this.db, job.notificationId);
    if (!n) throw new PermanentJobError('El aviso no existe');
    if (n.status !== 'pendiente') return; // ya salió (o ya falló): un reintento no reenvía

    try {
      await this.sender.send({
        to: n.recipient, subject: n.subject, text: n.body,
        messageId: `<${n.id}@avisos>`,
      });
    } catch (error) {
      const code = error instanceof EmailError ? error.message : 'envio_fallido';
      const final = isFinalFailure(job, error);
      await this.db.withTransaction(async (c) => {
        await this.notifications.recordFailure(c, n.id, code, final);
        if (final) {
          await this.audit.record(c, {
            claimId: n.claimId, type: AUDIT_EVENTS.AVISO_FALLIDO, actor: 'sistema',
            payload: { notificationId: n.id, kind: n.kind, error: code },
          });
        }
      });
      throw error; // el runner decide: reintento con espera o fallo definitivo
    }

    await this.db.withTransaction(async (c) => {
      if (await this.notifications.markSent(c, n.id)) {
        await this.audit.record(c, {
          claimId: n.claimId, type: AUDIT_EVENTS.AVISO_ENVIADO, actor: 'sistema',
          payload: { notificationId: n.id, kind: n.kind },
        });
      }
    });
  }
}
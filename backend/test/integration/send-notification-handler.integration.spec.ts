import { randomUUID } from 'node:crypto';
import { createTestContext, seedDocument } from './helpers';
import type { ClaimedJob } from '../../src/modules/jobs/job-queue';
import { isFinalFailure, PermanentJobError } from '../../src/modules/jobs/job-queue';
import { EmailError, type EmailMessage, type EmailSender } from '../../src/modules/notifications/email-sender';
import { NotificationsRepository } from '../../src/modules/notifications/notifications.repository';
import { SendNotificationHandler } from '../../src/modules/notifications/send-notification.handler';

const ctx = createTestContext();
afterAll(async () => {
  await ctx.db.onModuleDestroy();
});

class RecordingSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failWith?: { message: string; retryable: boolean };
  async send(message: EmailMessage): Promise<void> {
    if (this.failWith) throw new EmailError(this.failWith.message, this.failWith.retryable);
    this.sent.push(message);
  }
}

/** Correo real con destinatario saludable y aviso pendiente, listo para su trabajo. */
async function prepareNotice(overrides: Partial<EmailMessage> = {}) {
  const { claimId } = await seedDocument(ctx.db);
  const repository = new NotificationsRepository();
  const notificationId = await repository.insertIfNew(ctx.db, {
    claimId, kind: 'expediente_completo', recipient: 'ana.perez@example.com',
    subject: 'Tu expediente está completo', body: 'Hola, ...', dedupeKey: `e2e:aviso:${randomUUID()}`,
  });
  if (!notificationId) throw new Error('no se insertó el aviso');
  const message = { to: 'ana.perez@example.com', subject: 'Tu expediente está completo', text: 'Hola, ...', messageId: `<${notificationId}@avisos>`, ...overrides };
  const job = (attempts = 1, maxAttempts = 5): ClaimedJob => ({
    id: 1, kind: 'enviar_aviso', claimId, documentId: null, notificationId, attempts, maxAttempts,
  });
  return { claimId, notificationId, job, message };
}

const notificationRow = async (id: string) =>
  (await ctx.db.query(
    'SELECT kind, recipient, status, attempts, last_error, sent_at FROM notifications WHERE id = $1', [id])).rows[0];
const eventsOf = async (claimId: string, type: string) =>
  (await ctx.db.query('SELECT payload FROM claim_events WHERE claim_id = $1 AND event_type = $2', [claimId, type])).rows;

describe('SendNotificationHandler', () => {
  it('envía con el texto del aviso y solo una vez: los reintentos no duplican el correo', async () => {
    const sender = new RecordingSender();
    const handler = new SendNotificationHandler(ctx.db, new NotificationsRepository(), ctx.audit, sender);
    const { claimId, notificationId, job, message } = await prepareNotice();

    await handler.execute(job());
    await handler.execute(job(2, 5)); // un reintento que llega tarde

    expect(sender.sent).toEqual([message]);
    expect(await notificationRow(notificationId)).toMatchObject({
      status: 'enviada', attempts: 1, last_error: null,
    });
    expect((await notificationRow(notificationId)).sent_at).toBeInstanceOf(Date);
    expect(await eventsOf(claimId, 'aviso_enviado')).toEqual([{
      payload: { notificationId, kind: 'expediente_completo' },
    }]);
  });

  it('un fallo transitorio deja el aviso pendiente: se reintenta y no se rinde el caso', async () => {
    const sender = new RecordingSender();
    sender.failWith = { message: 'smtp_apagado', retryable: true };
    const handler = new SendNotificationHandler(ctx.db, new NotificationsRepository(), ctx.audit, sender);
    const { notificationId, job } = await prepareNotice();

    await expect(handler.execute(job(1, 5))).rejects.toThrow('smtp_apagado');

    expect(await notificationRow(notificationId)).toMatchObject({
      status: 'pendiente', attempts: 1, last_error: 'smtp_apagado',
    });
  });

  it('al agotar los intentos el aviso queda fallido y la bitácora lo dice', async () => {
    const sender = new RecordingSender();
    sender.failWith = { message: 'smtp_apagado', retryable: true };
    const handler = new SendNotificationHandler(ctx.db, new NotificationsRepository(), ctx.audit, sender);
    const { claimId, notificationId, job } = await prepareNotice();

    await expect(handler.execute(job(5, 5))).rejects.toThrow('smtp_apagado');
    expect(isFinalFailure(job(5, 5), new EmailError('smtp_apagado', true))).toBe(true);

    expect(await notificationRow(notificationId)).toMatchObject({
      status: 'fallida', attempts: 1, last_error: 'smtp_apagado',
    });
    expect(await eventsOf(claimId, 'aviso_fallido')).toEqual([{
      payload: { notificationId, kind: 'expediente_completo', error: 'smtp_apagado' },
    }]);
  });

  it('un trabajo sin aviso es un error permanente', async () => {
    const handler = new SendNotificationHandler(ctx.db, new NotificationsRepository(), ctx.audit, new RecordingSender());
    const { claimId } = await prepareNotice();
    const job = (): ClaimedJob => ({
      id: 1, kind: 'enviar_aviso', claimId, documentId: null, notificationId: null, attempts: 1, maxAttempts: 5,
    });
    await expect(handler.execute(job())).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('un aviso que ya no existe es un error permanente', async () => {
    const handler = new SendNotificationHandler(ctx.db, new NotificationsRepository(), ctx.audit, new RecordingSender());
    const { claimId } = await prepareNotice();
    const job = (): ClaimedJob => ({
      id: 1, kind: 'enviar_aviso', claimId, documentId: null,
      notificationId: randomUUID(), attempts: 1, maxAttempts: 5,
    });
    await expect(handler.execute(job())).rejects.toBeInstanceOf(PermanentJobError);
  });
});
// modules/intake/email-tracking-link-sender.ts

import { TrackingLink, TrackingLinkSender } from "../intake/tracking-link-sender";
import { EmailSender } from "../notifications/email-sender";
import { buildTrackingLinkEmail } from "../notifications/tracking-link-email";

export class EmailTrackingLinkSender implements TrackingLinkSender {
  constructor(private readonly email: EmailSender, private readonly frontendUrl: string) {}

  async send(link: TrackingLink): Promise<void> {
    // El token va en el fragmento: el navegador no lo envía a ningún servidor.
    const url = `${this.frontendUrl.replace(/\/+$/, '')}/seguimiento#${link.token}`;
    const { subject, text } = buildTrackingLinkEmail(link.referenceCode, url);
    await this.email.send({
      to: link.email, subject, text,
      messageId: `<tracking-${link.claimId}@avisos>`,
    });
  }
}
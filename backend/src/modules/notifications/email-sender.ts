// modules/notifications/email-sender.ts
export interface EmailMessage { 
  to: string; 
  subject: string; 
  text: string; 
  messageId?: string; 
}

export class EmailError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
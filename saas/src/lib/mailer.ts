export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: Mail): Promise<void>;
}

export function consoleMailer(): Mailer {
  return { async send(message) { console.info(`[mail] ${message.to} ${message.subject}\n${message.text}`); } };
}

export function resendMailer(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    async send(message) {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: message.to, subject: message.subject, text: message.text }),
      });
      if (!response.ok) throw new Error('The email service did not accept the message.');
    },
  };
}

export function emailConfigured(): boolean {
  const key = process.env.RESEND_API_KEY?.trim() ?? '';
  const from = process.env.MAIL_FROM?.trim() ?? '';
  return key.startsWith('re_') && from.includes('@');
}

export function mailerFromEnv(): Mailer {
  if (emailConfigured()) return resendMailer(process.env.RESEND_API_KEY!.trim(), process.env.MAIL_FROM!.trim());
  return consoleMailer();
}

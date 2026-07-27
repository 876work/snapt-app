import { env } from './env.js';

// Email delivery via Resend — Snapt's only out-of-app channel (there is no
// SMS anywhere in the product). Without RESEND_API_KEY the send is simulated
// so flows stay exercisable locally; the notification dispatcher (Phase 4)
// will route through this same module.

export interface EmailResult {
  sent: boolean;
  simulated: boolean;
  id?: string;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<EmailResult> {
  if (!env.resendApiKey) {
    console.log(`[email simulated] to=${to} subject="${subject}"`);
    return { sent: true, simulated: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.resendFrom, to: [to], subject, html }),
  });
  if (!res.ok) return { sent: false, simulated: false };
  const json = (await res.json()) as { id?: string };
  return { sent: true, simulated: false, id: json.id };
}

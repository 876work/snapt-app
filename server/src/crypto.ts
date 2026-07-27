import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// At-rest encryption for sensitive payout fields (bank account numbers).
// Key from PAYOUT_ENCRYPTION_KEY env; decrypted ONLY where the admin payout
// queue needs the full number to send money.
const key = createHash('sha256')
  .update(process.env.PAYOUT_ENCRYPTION_KEY ?? 'local-dev-only-key')
  .digest();

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

export function decryptField(stored: string): string {
  const [iv, tag, data] = stored.split('.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

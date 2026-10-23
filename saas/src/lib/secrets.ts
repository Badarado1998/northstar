import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keyBytes(secretKey: string): Buffer {
  const key = Buffer.from(secretKey, 'base64');
  if (key.length !== 32) throw new Error('SECRETS_KEY must be 32 bytes, base64-encoded.');
  return key;
}

export function encryptSecret(plain: string, secretKey: string): string {
  if (!plain || plain.length > 4096) throw new Error('That provider key is empty or too long.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(secretKey), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(stored: string, secretKey: string): string {
  const [version, ivRaw, tagRaw, bodyRaw] = stored.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !bodyRaw) throw new Error('Stored provider key is unreadable.');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(secretKey), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(bodyRaw, 'base64url')), decipher.final()]).toString('utf8');
}

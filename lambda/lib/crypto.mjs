import { createHash, randomUUID, randomBytes } from "node:crypto";

export function hashSecret(secret) {
  return createHash('sha256').update(secret).digest('hex');
}

export function generateClientCredentials() {
  const clientId = randomUUID();
  const rawSecret = randomBytes(32).toString('base64url'); // ~43 chars, url-safe
  const secretHash = hashSecret(rawSecret);
  const now = new Date().toISOString();
  
  return { clientId, rawSecret, secretHash, now };
}

export function getNow() {
  return new Date().toISOString();
}

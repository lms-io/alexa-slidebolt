import { db, USERS_TABLE } from '../../lib/dynamo.mjs';
import { generateClientCredentials } from '../../lib/crypto.mjs';

export async function createClient(payload) {
  const { clientId, rawSecret, secretHash, now } = generateClientCredentials();

  const item = {
    pk: `client#${clientId}`,
    clientId: clientId, // Redundant but useful for listing
    secretHash: secretHash,
    label: payload.label || 'Untitled',
    ownerEmail: payload.ownerEmail || null, // Authorized email to claim
    status: 'active',
    maxMsgsPerMinute: payload.maxMsgsPerMinute || 60,
    createdAt: now,
    updatedAt: now
  };

  await db(USERS_TABLE).put(item);

  return {
    ok: true,
    clientId: clientId,
    secret: rawSecret,
    createdAt: now
  };
}

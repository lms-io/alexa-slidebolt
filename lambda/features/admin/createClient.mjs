import { db, DATA_TABLE } from '../../lib/dynamo.mjs';
import { generateClientCredentials } from '../../lib/crypto.mjs';

export async function createClient(payload) {
  const { clientId, rawSecret, secretHash, now } = generateClientCredentials();

  const item = {
    pk: `CLIENT#${clientId}`,
    sk: 'METADATA',
    clientId: clientId, 
    secretHash: secretHash,
    label: payload.label || 'Untitled',
    status: 'active',
    maxMsgsPerMinute: payload.maxMsgsPerMinute || 60,
    createdAt: now,
    updatedAt: now
  };

  if (payload.ownerEmail) {
    item.ownerEmail = payload.ownerEmail;
    item.gsi1pk = `EMAIL#${payload.ownerEmail}`;
    item.gsi1sk = `CLIENT#${clientId}`;
  }

  await db(DATA_TABLE).put(item);

  return {
    ok: true,
    clientId: clientId,
    secret: rawSecret,
    createdAt: now
  };
}

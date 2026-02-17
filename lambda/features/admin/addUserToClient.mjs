import { db, DATA_TABLE } from '../../lib/dynamo.mjs';

export async function addUserToClient(payload) {
  const { userId, clientId } = payload;
  if (!userId || !clientId) throw new Error("Missing userId or clientId");

  const now = new Date().toISOString();

  // 1. Create User-to-Client Mapping
  const userItem = {
    pk: `USER#${userId}`,
    sk: 'METADATA',
    clientId: clientId,
    mappedAt: now,
    alexaAccessToken: null,
    alexaRefreshToken: null,
    alexaTokenExpiresAt: null
  };

  await db(DATA_TABLE).put(userItem);

  // 2. Update Client with ownerUserId (Best effort for admin action)
  try {
    await db(DATA_TABLE).update(
      { pk: `CLIENT#${clientId}`, sk: 'METADATA' },
      "SET ownerUserId = :u, updatedAt = :now",
      null,
      { ":u": userId, ":now": now }
    );
  } catch (err) {
    console.warn(`COULD_NOT_UPDATE_CLIENT_METADATA: ${err.message}`);
    // Non-fatal for this admin action
  }

  return { ok: true, userId, clientId };
}

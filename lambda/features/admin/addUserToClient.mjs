import { db, USERS_TABLE } from '../../lib/dynamo.mjs';

export async function addUserToClient(payload) {
  const { userId, clientId } = payload;
  if (!userId || !clientId) throw new Error("Missing userId or clientId");

  const item = {
    pk: `user#${userId}`,
    clientId: clientId,
    mappedAt: new Date().toISOString()
  };

  await db(USERS_TABLE).put(item);

  return { ok: true, userId, clientId };
}

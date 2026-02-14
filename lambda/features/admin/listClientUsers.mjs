import { db, USERS_TABLE } from '../../lib/dynamo.mjs';

export async function listClientUsers(payload) {
  const { clientId } = payload;
  if (!clientId) throw new Error("Missing clientId");

  // Scan for user records mapping to this client
  const res = await db(USERS_TABLE).scan(
    "clientId = :cid AND begins_with(pk, :prefix)",
    { ":cid": clientId, ":prefix": "user#" }
  );

  const users = (res.Items || []).map(item => ({
    userId: item.pk.replace('user#', ''),
    email: item.email || null,
    mappedAt: item.mappedAt,
    lastSeen: item.lastSeen || null
  }));

  return { ok: true, clientId, users };
}

import { db, DATA_TABLE } from '../../lib/dynamo.mjs';

export async function listClientUsers(payload) {
  const { clientId } = payload;
  if (!clientId) throw new Error("Missing clientId");

  // Scan for user records mapping to this client
  const res = await db(DATA_TABLE).scan(
    "clientId = :cid AND begins_with(pk, :prefix) AND sk = :s",
    { ":cid": clientId, ":prefix": "USER#", ":s": "METADATA" }
  );

  const users = (res.Items || []).map(item => ({
    userId: item.pk.replace('USER#', ''),
    email: item.email || null,
    mappedAt: item.mappedAt,
    lastSeen: item.lastSeen || null,
    alexaLinked: !!item.alexaAccessToken
  }));

  return { ok: true, clientId, users };
}

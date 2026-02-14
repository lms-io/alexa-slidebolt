import { db, USERS_TABLE } from '../../lib/dynamo.mjs';

export async function revokeClient(payload) {
  const clientId = payload.clientId;
  if (!clientId) throw new Error("Missing clientId");

  const now = new Date().toISOString();

  await db(USERS_TABLE).update(
    { pk: `client#${clientId}` },
    "set #s = :revoked, updatedAt = :now",
    { "#s": "status" },
    {
      ":revoked": "revoked",
      ":now": now
    }
  );

  return { ok: true, clientId, status: "revoked", updatedAt: now };
}

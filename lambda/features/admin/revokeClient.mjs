import { db, DATA_TABLE } from '../../lib/dynamo.mjs';

export async function revokeClient(payload) {
  const clientId = payload.clientId;
  if (!clientId) throw new Error("Missing clientId");

  const now = new Date().toISOString();

  await db(DATA_TABLE).update(
    { pk: `CLIENT#${clientId}`, sk: 'METADATA' },
    "set #s = :revoked, updatedAt = :now",
    { "#s": "status" },
    {
      ":revoked": "revoked",
      ":now": now
    }
  );

  return { ok: true, clientId, status: "revoked", updatedAt: now };
}

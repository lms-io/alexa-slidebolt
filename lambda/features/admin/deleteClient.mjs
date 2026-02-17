import { db, DATA_TABLE } from '../../lib/dynamo.mjs';

export async function deleteClient(payload) {
  const clientId = payload.clientId;
  if (!clientId) throw new Error("Missing clientId");

  await db(DATA_TABLE).delete({ pk: `CLIENT#${clientId}`, sk: 'METADATA' });

  return { ok: true, clientId, status: "deleted" };
}

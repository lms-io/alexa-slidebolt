import { db, USERS_TABLE } from '../../lib/dynamo.mjs';

export async function deleteClient(payload) {
  const clientId = payload.clientId;
  if (!clientId) throw new Error("Missing clientId");

  await db(USERS_TABLE).delete({ pk: `client#${clientId}` });

  return { ok: true, clientId, status: "deleted" };
}

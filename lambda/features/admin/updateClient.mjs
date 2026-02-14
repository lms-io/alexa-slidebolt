import { db, USERS_TABLE } from '../../lib/dynamo.mjs';

export async function updateClient(payload) {
  const clientId = payload.clientId;
  if (!clientId) throw new Error("Missing clientId");

  let updateExp = "set updatedAt = :now";
  const expValues = { ":now": new Date().toISOString() };
  const expNames = {};

  if (payload.maxMsgsPerMinute !== undefined) {
    updateExp += ", maxMsgsPerMinute = :limit";
    expValues[":limit"] = payload.maxMsgsPerMinute;
  }
  
  await db(USERS_TABLE).update(
    { pk: `client#${clientId}` },
    updateExp,
    expNames,
    expValues
  );

  return { ok: true, clientId, updatedAt: expValues[":now"] };
}

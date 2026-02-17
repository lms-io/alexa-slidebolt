import { db, DATA_TABLE } from '../../lib/dynamo.mjs';

export async function removeUserFromClient(payload) {
  const { userId } = payload;
  if (!userId) throw new Error("Missing userId");

  await db(DATA_TABLE).delete({ pk: `USER#${userId}`, sk: 'METADATA' });

  return { ok: true, userId, status: "removed" };
}

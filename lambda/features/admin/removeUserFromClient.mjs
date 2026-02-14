import { db, USERS_TABLE } from '../../lib/dynamo.mjs';

export async function removeUserFromClient(payload) {
  const { userId } = payload;
  if (!userId) throw new Error("Missing userId");

  await db(USERS_TABLE).delete({ pk: `user#${userId}` });

  return { ok: true, userId, status: "removed" };
}

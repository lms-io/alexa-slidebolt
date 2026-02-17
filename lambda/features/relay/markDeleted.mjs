import { db, DATA_TABLE } from '../../lib/dynamo.mjs';

export async function handleMarkDeleted(clientId, body, now) {
  const deviceIds = body.deviceIds || [];
  if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
    return { error: "Missing or invalid deviceIds list" };
  }

  console.log(`MARK_DELETED: clientId=${clientId} count=${deviceIds.length}`);

  // Process in serial for simplicity in Lambda, or use Promise.all for speed.
  // DynamoDB update is fast.
  const results = await Promise.all(deviceIds.map(async (id) => {
    try {
      await db(DATA_TABLE).update(
        { pk: `CLIENT#${clientId}`, sk: `DEVICE#${id}` },
        "SET #status = :deleted, updatedAt = :u, clientId = :cid",
        { "#status": "status" },
        { ":deleted": "deleted", ":u": now, ":cid": clientId }
      );
      return { id, ok: true };
    } catch (err) {
      console.error(`MARK_DELETED_FAIL: id=${id}`, err);
      return { id, ok: false, error: err.message };
    }
  }));

  return { ok: true, results };
}

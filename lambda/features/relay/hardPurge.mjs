import { db, DATA_TABLE } from '../../lib/dynamo.mjs';

export async function handleHardPurge(clientId) {
  // 1. Find all deleted devices
  const res = await db(DATA_TABLE).query(
    "pk = :pk AND begins_with(sk, :sk)",
    { ":pk": `CLIENT#${clientId}`, ":sk": "DEVICE#" }
  );
  
  const toDelete = (res.Items || []).filter(item => item.status === 'deleted');
  
  if (toDelete.length === 0) {
    return { ok: true, message: "No deleted devices to purge" };
  }

  console.log(`HARD_PURGE: clientId=${clientId} count=${toDelete.length}`);

  // 2. Delete them from DynamoDB
  // Note: BatchWriteItem would be more efficient for large lists, 
  // but individual deletes are safer for moderate sizes.
  await Promise.all(toDelete.map(item => 
    db(DATA_TABLE).delete({ pk: item.pk, sk: item.sk })
  ));

  return { ok: true, count: toDelete.length };
}

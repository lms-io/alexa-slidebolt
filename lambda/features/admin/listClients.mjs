import { db, DATA_TABLE } from '../../lib/dynamo.mjs';

export async function listClients() {
  // Filter for client records (METADATA items in CLIENT# partitions)
  const response = await db(DATA_TABLE).scan(
    "begins_with(pk, :p) AND sk = :s", 
    { ":p": "CLIENT#", ":s": "METADATA" }
  );

  const clients = (response.Items || []).map(item => ({
    clientId: item.clientId,
    label: item.label,
    status: item.status,
    ownerEmail: item.ownerEmail,
    ownerUserId: item.ownerUserId,
    maxMsgsPerMinute: item.maxMsgsPerMinute,
    createdAt: item.createdAt
  }));

  return { ok: true, clients };
}

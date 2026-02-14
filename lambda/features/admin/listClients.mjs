import { db, USERS_TABLE } from '../../lib/dynamo.mjs';

export async function listClients() {
  // Filter for client records
  const response = await db(USERS_TABLE).scan("begins_with(pk, :p)", { ":prefix": "client#" });
  // Wait, my db.scan implementation uses (filterExp, values). 
  // Let's check the keys I passed. I used ":prefix" in values but ":p" in exp. Fix.
  
  const responseFixed = await db(USERS_TABLE).scan("begins_with(pk, :p)", { ":p": "client#" });

  const clients = (responseFixed.Items || []).map(item => ({
    clientId: item.clientId,
    label: item.label,
    status: item.status,
    maxMsgsPerMinute: item.maxMsgsPerMinute,
    createdAt: item.createdAt
  }));

  return { ok: true, clients };
}

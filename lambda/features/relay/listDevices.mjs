import { db, DATA_TABLE } from '../../lib/dynamo.mjs';
import { reply } from '../../lib/ws.mjs';

export async function handleListDevices(clientId, connectionId) {
  // Query all items in the client's partition starting with DEVICE#
  const res = await db(DATA_TABLE).query(
    "pk = :pk AND begins_with(sk, :sk)",
    { ":pk": `CLIENT#${clientId}`, ":sk": "DEVICE#" }
  );
  
  const devices = (res.Items || []).map(item => ({
    endpointId: item.sk.replace('DEVICE#', ''),
    ...item.endpoint,
    state: item.state,
    status: item.status,
    updatedAt: item.updatedAt
  }));
  
  const response = { ok: true, devices };
  console.log("LIST_DEVICES: Replying to", connectionId);
  await reply(connectionId, response);

  return { statusCode: 200, body: "ok" };
}
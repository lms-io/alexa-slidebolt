import { db, DEVICES_TABLE } from '../../lib/dynamo.mjs';
import { reply } from '../../lib/ws.mjs';

export async function handleListDevices(clientId, connectionId) {
  // Debug: DB Query logic restored
  const res = await db(DEVICES_TABLE).query(
    "clientId = :pk AND begins_with(sk, :sk)",
    { ":pk": clientId, ":sk": "device#" }
  );
  
  const devices = (res.Items || []).map(item => ({
    endpointId: item.sk.replace('device#', ''),
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
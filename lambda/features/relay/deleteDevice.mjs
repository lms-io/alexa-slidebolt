import { db, DEVICES_TABLE } from '../../lib/dynamo.mjs';

export async function handleDeleteDevice(clientId, body) {
  const deviceId = body.deviceId;
  if (!deviceId) return { error: "Missing deviceId" };

  await db(DEVICES_TABLE).delete({
    clientId: clientId,
    sk: `device#${deviceId}`
  });

  return { ok: true, deviceId, status: "deleted" };
}
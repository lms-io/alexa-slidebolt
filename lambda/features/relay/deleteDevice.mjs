import { db, DATA_TABLE } from '../../lib/dynamo.mjs';

export async function handleDeleteDevice(clientId, body) {
  const deviceId = body.deviceId;
  if (!deviceId) return { error: "Missing deviceId" };

  await db(DATA_TABLE).delete({
    pk: `CLIENT#${clientId}`,
    sk: `DEVICE#${deviceId}`
  });

  return { ok: true, deviceId, status: "deleted" };
}
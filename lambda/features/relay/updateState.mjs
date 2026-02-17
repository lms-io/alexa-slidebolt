import { db, DATA_TABLE } from '../../lib/dynamo.mjs';

export async function handleStateUpdate(clientId, body, now) {
  const deviceId = body.deviceId;
  const state = body.state;
  if (!deviceId || !state) return { statusCode: 400 };

  let updateExp = "SET #state = :s, updatedAt = :u, #status = if_not_exists(#status, :new), firstSeen = if_not_exists(firstSeen, :u), clientId = :cid";
  const expValues = {
    ":s": state,
    ":u": now,
    ":new": "new",
    ":cid": clientId
  };
  const expNames = {
    "#status": "status",
    "#state": "state",
  };

  await db(DATA_TABLE).update(
    { pk: `CLIENT#${clientId}`, sk: `DEVICE#${deviceId}` },
    updateExp,
    expNames,
    expValues
  );

  console.log(`STATE_OK: clientId=${clientId} deviceId=${deviceId}`);

  return { ok: true };
}
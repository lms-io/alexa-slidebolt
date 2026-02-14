import { db, DEVICES_TABLE } from '../../lib/dynamo.mjs';

export async function handleDeviceUpsert(clientId, body, now) {
  const endpoint = body.endpoint || {};
  const state = body.state;
  const endpointId = endpoint.endpointId;

  if (!endpointId) return { statusCode: 400 };

  let updateExp = "SET endpointId = :eid, #endpoint = :ep, updatedAt = :u, #status = if_not_exists(#status, :new), firstSeen = if_not_exists(firstSeen, :u)";
  const expValues = {
    ":eid": endpointId,
    ":ep": endpoint,
    ":u": now,
    ":new": "new",
  };
  const expNames = {
    "#status": "status",
    "#endpoint": "endpoint",
  };

  if (state) {
    updateExp += ", #state = :s";
    expValues[":s"] = state;
    expNames["#state"] = "state";
  }

  await db(DEVICES_TABLE).update(
    { clientId: clientId, sk: `device#${endpointId}` },
    updateExp,
    expNames,
    expValues
  );

  console.log(`UPSERT_OK: clientId=${clientId} deviceId=${endpointId} name="${endpoint.friendlyName}"`);

  return { ok: true };
}
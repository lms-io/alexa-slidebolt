import { db, DATA_TABLE } from '../../lib/dynamo.mjs';

export async function handleDeviceUpsert(clientId, body, now) {
  const endpoint = body.endpoint || {};
  const state = body.state;
  const endpointId = endpoint.endpointId;

  if (!endpointId) return { statusCode: 400 };

  let updateExp = "SET endpointId = :eid, #endpoint = :ep, updatedAt = :u, #status = :active, firstSeen = if_not_exists(firstSeen, :u)";
  const expValues = {
    ":eid": endpointId,
    ":ep": endpoint,
    ":u": now,
    ":active": "active",
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

  // Ensure clientId is present on the record for easy reverse-lookup
  updateExp += ", clientId = :cid";
  expValues[":cid"] = clientId;

  await db(DATA_TABLE).update(
    { pk: `CLIENT#${clientId}`, sk: `DEVICE#${endpointId}` },
    updateExp,
    expNames,
    expValues
  );

  console.log(`UPSERT_OK: clientId=${clientId} deviceId=${endpointId} name="${endpoint.friendlyName}"`);

  return { ok: true };
}
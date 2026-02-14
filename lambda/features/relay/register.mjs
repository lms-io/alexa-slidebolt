import { db, USERS_TABLE, DEVICES_TABLE } from '../../lib/dynamo.mjs';
import { hashSecret } from '../../lib/crypto.mjs';
import { reply } from '../../lib/ws.mjs';

export async function handleRegister(clientId, body, connectionId, now) {
  const secret = body.secret;
  if (!secret) {
    await reply(connectionId, { error: "Missing secret" });
    return { statusCode: 403 };
  }

  // 1. Get Client Meta
  const res = await db(USERS_TABLE).get({ pk: `client#${clientId}` });
  const meta = res.Item;

  if (!meta) {
    console.log(`REGISTER_FAIL: Client ${clientId} not found`);
    await reply(connectionId, { error: "Invalid client" });
    return { statusCode: 403 };
  }

  // 2. Validate Status
  if (meta.status !== 'active') {
    console.log(`REGISTER_FAIL: Client ${clientId} is ${meta.status}`);
    await reply(connectionId, { error: "Client inactive" });
    return { statusCode: 403 };
  }

  // 3. Validate Secret
  const providedHash = hashSecret(secret);
  if (providedHash !== meta.secretHash) {
    console.log(`REGISTER_FAIL: Client ${clientId} wrong secret`);
    await reply(connectionId, { error: "Invalid secret" });
    return { statusCode: 403 };
  }

  // 4. Store Connection in Devices Table
  await db(DEVICES_TABLE).put({
    clientId: clientId,
    sk: 'conn',
    connectionId: connectionId,
    connectedAt: now,
    ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
  });

  console.log(`REGISTER_OK: Client ${clientId} on ${connectionId}`);

  const limit = meta.maxMsgsPerMinute || 60;
  
  await reply(connectionId, { 
    status: "ok", 
    rateLimit: { maxPerMinute: limit } 
  });

  return { statusCode: 200, body: "ok" };
}
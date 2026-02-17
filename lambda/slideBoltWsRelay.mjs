import { db, DATA_TABLE } from './lib/dynamo.mjs';
import { reply } from './lib/ws.mjs';
import { handleRegister } from './features/relay/register.mjs';
import { handleDeviceUpsert } from './features/relay/upsertDevice.mjs';
import { handleStateUpdate } from './features/relay/updateState.mjs';
import { handleListDevices } from './features/relay/listDevices.mjs';
import { handleDeleteDevice } from './features/relay/deleteDevice.mjs';
import { handleMarkDeleted } from './features/relay/markDeleted.mjs';
import { handleRetryDeleted } from './features/relay/retryDeleted.mjs';
import { handleHardPurge } from './features/relay/hardPurge.mjs';
import { checkRateLimit } from './features/relay/rateLimit.mjs';

export const handler = async (event) => {
  const rc = event?.requestContext || {};
  const routeKey = rc.routeKey;
  const connectionId = rc.connectionId;
  const now = new Date().toISOString();

  // --- Connection Lifecycle ---
  if (routeKey === '$connect') return { statusCode: 200, body: 'ok' };

  if (routeKey === '$disconnect') {
    console.log("DISCONNECT", connectionId);
    // Cleanup reverse lookup session
    try {
      const sess = await db(DATA_TABLE).get({ pk: `CONN#${connectionId}`, sk: 'SESSION' });
      if (sess.Item) {
        const cid = sess.Item.clientId;
        console.log(`CLEANUP: Removing session for ${cid} on ${connectionId}`);
        await db(DATA_TABLE).delete({ pk: `CONN#${connectionId}`, sk: 'SESSION' });
        // Optional: Also cleanup CLIENT#sk:CONN if it matches this connectionId
        const clientConn = await db(DATA_TABLE).get({ pk: `CLIENT#${cid}`, sk: 'CONN' });
        if (clientConn.Item?.connectionId === connectionId) {
          await db(DATA_TABLE).delete({ pk: `CLIENT#${cid}`, sk: 'CONN' });
        }
      }
    } catch (err) {
      console.error("DISCONNECT_CLEANUP_FAIL", err);
    }
    return { statusCode: 200, body: 'ok' };
  }

  let parsedBody = null;
  try {
    if (event.body) {
      parsedBody = JSON.parse(event.body);
    }
  } catch (e) {
    if (connectionId) await reply(connectionId, { error: "Invalid JSON" });
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // --- Identity Resolution ---
  let clientId = null;
  const isRegister = routeKey === 'register' || parsedBody?.action === 'register';

  if (isRegister) {
    clientId = parsedBody?.clientId;
  } else {
    // Resolve identity from connection state
    try {
      const sessionRes = await db(DATA_TABLE).get({ pk: `CONN#${connectionId}`, sk: 'SESSION' });
      clientId = sessionRes.Item?.clientId;
    } catch (err) {
      console.error("SESSION_LOOKUP_FAIL", err);
    }
  }

  if (!clientId) {
    console.warn(`UNAUTHENTICATED_ACCESS: connection=${connectionId} action=${parsedBody?.action || routeKey}`);
    await reply(connectionId, { error: "Unauthorized" });
    return { statusCode: 403, body: "Unauthorized" };
  }

  // SPOOF CHECK: If they sent a clientId in the body that differs from their session, REJECT it.
  if (!isRegister && parsedBody?.clientId && parsedBody.clientId !== clientId) {
    console.warn(`SPOOF_BLOCKED: connection=${connectionId} session=${clientId} body=${parsedBody.clientId}`);
    await reply(connectionId, { error: "Unauthorized" });
    return { statusCode: 403, body: "Unauthorized" };
  }

  // --- Rate Limiting ---
  if (!isRegister) {
     try {
       const isAllowed = await checkRateLimit(clientId);
       if (!isAllowed) {
         console.warn(`THROTTLED clientId=${clientId}`);
         await reply(connectionId, { error: "Rate limit exceeded" });
         return { statusCode: 429, body: "Rate limit exceeded" };
       }
     } catch (err) {
       console.error("RATE_LIMIT_CHECK_FAIL", err);
     }
  }

  // --- Dispatch ---
  try {
    let result = null;
    console.log(`DISPATCH: action=${parsedBody?.action || routeKey} clientId=${clientId} implicit=${!isRegister} body=${JSON.stringify(parsedBody)}`);

    if (isRegister) {
      return await handleRegister(clientId, parsedBody, connectionId, now);
    } 
    
    switch (parsedBody?.action) {
      case 'state_update':
        result = await handleStateUpdate(clientId, parsedBody, now);
        break;
      case 'device_upsert':
        result = await handleDeviceUpsert(clientId, parsedBody, now);
        break;
      case 'list_devices':
        result = await handleListDevices(clientId, connectionId);
        break;
      case 'device_delete':
        result = await handleDeleteDevice(clientId, parsedBody);
        break;
      case 'device_mark_deleted':
        result = await handleMarkDeleted(clientId, parsedBody, now);
        break;
      case 'alexa_retry_deleted':
        result = await handleRetryDeleted(clientId, connectionId);
        break;
      case 'device_hard_purge':
        result = await handleHardPurge(clientId);
        break;
      default:
        result = { error: `Unknown action: ${parsedBody?.action}` };
    }

    if (result && !result.statusCode) {
      if (connectionId) {
        await reply(connectionId, result);
        return { statusCode: 200, body: "ok" };
      } else {
        return { statusCode: 200, body: JSON.stringify(result) };
      }
    }

    return result || { statusCode: 200, body: "ok" };

  } catch (err) {
    console.error("RELAY_ERROR", err);
    await reply(connectionId, { error: "Internal Server Error" });
    return { statusCode: 500, body: "Internal Server Error" };
  }
};
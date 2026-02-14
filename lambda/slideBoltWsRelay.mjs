import { reply } from './lib/ws.mjs';
import { handleRegister } from './features/relay/register.mjs';
import { handleDeviceUpsert } from './features/relay/upsertDevice.mjs';
import { handleStateUpdate } from './features/relay/updateState.mjs';
import { handleListDevices } from './features/relay/listDevices.mjs';
import { handleDeleteDevice } from './features/relay/deleteDevice.mjs';
import { checkRateLimit } from './features/relay/rateLimit.mjs';

export const handler = async (event) => {
  const rc = event?.requestContext || {};
  const routeKey = rc.routeKey;
  const connectionId = rc.connectionId;
  const now = new Date().toISOString();

  let parsedBody = null;
  try {
    if (event.body) {
      parsedBody = JSON.parse(event.body);
    }
  } catch (e) {
    if (connectionId) await reply(connectionId, { error: "Invalid JSON" });
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // --- Connection Lifecycle ---
  if (routeKey === '$connect' || routeKey === '$disconnect') {
    if (routeKey === '$disconnect') {
       console.log("DISCONNECT", connectionId);
       // Optional: Cleanup conn record if we knew clientId
    }
    return { statusCode: 200, body: 'ok' };
  }

  const clientId = parsedBody?.clientId;
  if (!clientId) {
    await reply(connectionId, { error: "Missing clientId" });
    return { statusCode: 400, body: "Missing clientId" };
  }

  // --- Rate Limiting ---
  if (routeKey !== 'register') {
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

  

      console.log(`DISPATCH: action=${parsedBody?.action || routeKey} clientId=${clientId}`);

  

      if (routeKey === 'register' || parsedBody?.action === 'register') {

  
      // Register handles its own reply logic internally (including errors)
      return await handleRegister(clientId, parsedBody, connectionId, now);
    } 
    
    // Other actions
    console.log(`DISPATCH: action=${parsedBody?.action} clientId=${clientId}`);
    switch (parsedBody?.action) {
      case 'state_update':
        result = await handleStateUpdate(clientId, parsedBody, now);
        break;
      case 'device_upsert':
        result = await handleDeviceUpsert(clientId, parsedBody, now);
        break;
      case 'list_devices':
        console.log("DISPATCH: list_devices", clientId);
        result = await handleListDevices(clientId, connectionId);
        console.log("RESULT: list_devices", JSON.stringify(result));
        break;
      case 'delete_device':
        result = await handleDeleteDevice(clientId, parsedBody);
        break;
      default:
        result = { error: `Unknown action: ${parsedBody?.action}` };
    }

    // If result is a plain object (no statusCode), treat as response body
    if (result && !result.statusCode) {
      if (connectionId) {
        console.log("REPLYING:", JSON.stringify(result));
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
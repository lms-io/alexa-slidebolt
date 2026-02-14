import { reply } from './lib/ws.mjs';
import { createClient } from './features/admin/createClient.mjs';
import { listClients } from './features/admin/listClients.mjs';
import { revokeClient } from './features/admin/revokeClient.mjs';
import { updateClient } from './features/admin/updateClient.mjs';
import { deleteClient } from './features/admin/deleteClient.mjs';
import { addUserToClient } from './features/admin/addUserToClient.mjs';
import { removeUserFromClient } from './features/admin/removeUserFromClient.mjs';
import { listClientUsers } from './features/admin/listClientUsers.mjs';

const ADMIN_SECRET = process.env.ADMIN_SECRET;

export const handler = async (event) => {
  console.log("Admin event:", JSON.stringify(event, null, 2));

  const { requestContext, body } = event;
  const routeKey = requestContext.routeKey;
  const connectionId = requestContext.connectionId;
  
  let payload;
  try {
    payload = typeof body === 'string' ? JSON.parse(body) : body;
  } catch (e) {
    if (connectionId) await reply(connectionId, { error: "Invalid JSON body" });
    return { statusCode: 400, body: "Invalid JSON body" };
  }

  // 1. Validate Admin Auth
  const providedToken = payload?.auth?.token;
  if (!ADMIN_SECRET || providedToken !== ADMIN_SECRET) {
    console.log("Admin auth failed");
    if (connectionId) await reply(connectionId, { error: "Unauthorized" });
    return { statusCode: 403, body: "Unauthorized" };
  }

  try {
    let resultBody = {};

    switch (routeKey) {
      case "admin_create_client":
        resultBody = await createClient(payload);
        break;
      case "admin_list_clients":
        resultBody = await listClients();
        break;
      case "admin_revoke_client":
        resultBody = await revokeClient(payload);
        break;
      case "admin_update_client":
        resultBody = await updateClient(payload);
        break;
      case "admin_delete_client":
        resultBody = await deleteClient(payload);
        break;
      case "admin_add_user_to_client":
        resultBody = await addUserToClient(payload);
        break;
      case "admin_remove_user_from_client":
        resultBody = await removeUserFromClient(payload);
        break;
      case "admin_list_client_users":
        resultBody = await listClientUsers(payload);
        break;
      default:
        resultBody = { error: `Unknown admin route: ${routeKey}` };
    }

    if (connectionId) {
      await reply(connectionId, resultBody);
      return { statusCode: 200, body: "ok" };
    } else {
      return { statusCode: 200, body: JSON.stringify(resultBody) };
    }

  } catch (err) {
    console.error("Admin error:", err);
    if (connectionId) await reply(connectionId, { error: err.message });
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

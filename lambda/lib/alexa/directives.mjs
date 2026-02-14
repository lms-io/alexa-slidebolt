import { db, DEVICES_TABLE } from '../dynamo.mjs';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";

const WS_MGMT_ENDPOINT = process.env.WS_MGMT_ENDPOINT;
const mgmt = WS_MGMT_ENDPOINT ? new ApiGatewayManagementApiClient({ endpoint: WS_MGMT_ENDPOINT }) : null;

export async function getConnectionId(clientId) {
  try {
    const res = await db(DEVICES_TABLE).get({
      clientId: clientId,
      sk: "conn"
    });
    if (!res.Item) return null;
    return res.Item.connectionId;
  } catch (err) {
    console.log("GET_CONN_FAIL", err.message);
    return null;
  }
}

export async function postDirectiveToClient(clientId, directive) {
  const connectionId = await getConnectionId(clientId);
  if (!connectionId) {
    console.log(`WS_SEND_SKIP: No connection for client ${clientId}`);
    return;
  }

  if (!mgmt) {
    console.log("WS_SEND_SKIP: No MGMT client");
    return;
  }

  const payload = {
    type: "alexaDirective",
    ts: new Date().toISOString(),
    directive
  };

  try {
    await mgmt.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(payload), "utf8")
    }));
    console.log(`WS_SEND_OK: ${connectionId}`);
  } catch (err) {
    console.log(`WS_SEND_FAIL: ${err.message}`);
  }
}

export async function markDeviceActive(clientId, endpointId) {
  if (!endpointId || !clientId) return;
  try {
    await db(DEVICES_TABLE).update(
      { clientId: clientId, sk: `device#${endpointId}` },
      "SET #status = :active",
      { "#status": "status" },
      { ":active": "active" },
      "attribute_exists(clientId)"
    );
  } catch (err) {
    // Ignore
  }
}

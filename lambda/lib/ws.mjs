import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";

const WS_MGMT_ENDPOINT = process.env.WS_MGMT_ENDPOINT;
console.log("WS_MGMT_ENDPOINT:", WS_MGMT_ENDPOINT); // Debug log

const mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_MGMT_ENDPOINT });

export async function reply(connectionId, body) {
  if (!connectionId) return;
  try {
    const data = Buffer.from(JSON.stringify(body));
    console.log(`WS_REPLY: sending ${data.length} bytes to ${connectionId}`);
    await mgmt.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: data
    }));
  } catch (err) {
    console.error(`WS_REPLY_FAIL connectionId=${connectionId}`, err.message, err.code);
    // Rethrow so the caller knows it failed? 
    // Or at least don't swallow silently if it's critical.
  }
}
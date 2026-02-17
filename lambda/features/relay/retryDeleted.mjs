import { db, DATA_TABLE } from '../../lib/dynamo.mjs';
import { getValidAlexaToken } from '../../lib/alexa/tokens.mjs';

export async function handleRetryDeleted(clientId, connectionId) {
  // 1. Find all deleted devices for this client
  const res = await db(DATA_TABLE).query(
    "pk = :pk AND begins_with(sk, :sk)",
    { ":pk": `CLIENT#${clientId}`, ":sk": "DEVICE#" }
  );
  
  const deletedDevices = (res.Items || []).filter(item => item.status === 'deleted');
  
  if (deletedDevices.length === 0) {
    return { ok: true, message: "No deleted devices found to retry" };
  }

  // 2. Identify User for Alexa Token
  const metaPk = `CLIENT#${clientId}`;
  const metaRes = await db(DATA_TABLE).get({ pk: metaPk, sk: 'METADATA' });
  const meta = metaRes.Item;
  const userId = meta?.ownerUserId;

  if (!userId) {
    return { error: "No owner associated with this client. Cannot send Alexa reports." };
  }

  const accessToken = await getValidAlexaToken(userId);
  if (!accessToken) {
    return { error: "Could not obtain valid Alexa token" };
  }

  // 3. Batch send DeleteReports to Alexa (Limit 100 per request)
  const deviceIds = deletedDevices.map(d => d.sk.replace('DEVICE#', ''));
  const chunks = [];
  for (let i = 0; i < deviceIds.length; i += 100) {
    chunks.push(deviceIds.slice(i, i + 100));
  }

  console.log(`RETRY_DELETED: clientId=${clientId} total=${deviceIds.length} batches=${chunks.length}`);

  for (const chunk of chunks) {
    const report = {
      event: {
        header: {
          namespace: "Alexa.Discovery",
          name: "DeleteReport",
          payloadVersion: "3",
          messageId: `${Date.now()}-${Math.random().toString(36).substring(7)}`
        },
        payload: {
          endpoints: chunk.map(id => ({ endpointId: id })),
          scope: { type: "BearerToken", token: accessToken }
        }
      }
    };

    const alexaRes = await fetch("https://api.amazonalexa.com/v3/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      body: JSON.stringify(report)
    });

    if (!alexaRes.ok) {
      console.warn(`RETRY_DELETED_FAIL: Alexa Gateway returned ${alexaRes.status}`);
    }
  }

  return { ok: true, count: deviceIds.length };
}

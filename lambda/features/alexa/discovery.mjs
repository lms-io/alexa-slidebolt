import { db, DATA_TABLE } from '../../lib/dynamo.mjs';
import { msgId } from '../../lib/alexa/response.mjs';
import { markDeviceActive } from '../../lib/alexa/directives.mjs';

export async function handleDiscovery(clientId) {
  try {
    console.log(`DISCOVERY_START: clientId=${clientId}`);
    const res = await db(DATA_TABLE).query(
      "pk = :pk AND begins_with(sk, :sk)",
      { ":pk": `CLIENT#${clientId}`, ":sk": "DEVICE#" }
    );
    
    const devices = res.Items || [];
    console.log(`DISCOVERY_DB_RESULTS: found ${devices.length} devices`);

    const endpoints = devices.map(d => {
      if (!d.endpoint) {
        console.warn(`DISCOVERY_WARN: Device ${d.sk} is missing the 'endpoint' property.`);
      }
      return d.endpoint;
    }).filter(Boolean);

    console.log(`DISCOVERY_ENDPOINTS_MAPPED: count ${endpoints.length}`);

    // Mark active
    for (const dev of devices) {
      const id = dev.endpoint?.endpointId || dev.endpointId;
      if (id) {
        try {
          await markDeviceActive(clientId, id);
          console.log(`DISCOVERY_MARK_ACTIVE: success for device=${id}`);
        } catch (e) {
          console.error(`DISCOVERY_MARK_ACTIVE: fail for device=${id}`, e.message);
        }
      }
    }

    const response = {
      event: {
        header: {
          namespace: "Alexa.Discovery",
          name: "Discover.Response",
          payloadVersion: "3",
          messageId: msgId(),
        },
        payload: { endpoints },
      },
    };

    console.log("DISCOVERY_FINAL_RESPONSE:", JSON.stringify(response, null, 2));
    return response;

  } catch (err) {
    console.error("DISCOVERY_ERROR_CRITICAL:", err.stack || err);
    return { event: { header: {}, payload: { endpoints: [] } } };
  }
}

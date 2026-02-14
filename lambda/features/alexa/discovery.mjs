import { db, DEVICES_TABLE } from '../../lib/dynamo.mjs';
import { msgId } from '../../lib/alexa/response.mjs';
import { markDeviceActive } from '../../lib/alexa/directives.mjs';

export async function handleDiscovery(clientId) {
  try {
    const res = await db(DEVICES_TABLE).query(
      "clientId = :cid AND begins_with(sk, :prefix)",
      { ":cid": clientId, ":prefix": "device#" }
    );
    
    const devices = res.Items || [];
    const endpoints = devices.map(d => d.endpoint).filter(Boolean);

    // Mark active
    for (const dev of devices) {
      const id = dev.endpoint?.endpointId || dev.endpointId;
      if (id) await markDeviceActive(clientId, id);
    }

    return {
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
  } catch (err) {
    console.error("DISCOVERY_ERROR", err);
    return { event: { header: {}, payload: { endpoints: [] } } }; // Fail safe?
  }
}

import { db, DATA_TABLE } from '../../lib/dynamo.mjs';
import { msgId, errorResponse } from '../../lib/alexa/response.mjs';
import { markDeviceActive } from '../../lib/alexa/directives.mjs';

export async function handleReportState(clientId, directive) {
  const endpointId = directive.endpoint?.endpointId;
  const correlationToken = directive.header.correlationToken;

  if (!endpointId) return errorResponse("INVALID_DIRECTIVE", "Missing endpointId", correlationToken);

  try {
    const res = await db(DATA_TABLE).get({
      pk: `CLIENT#${clientId}`,
      sk: `DEVICE#${endpointId}`
    });
    
    const item = res.Item || null;

    if (!item) {
      // Send DeleteReport so Alexa removes the stale device
      try {
        const accessToken = directive.endpoint?.scope?.token;
        if (accessToken) {
          const report = {
            event: {
              header: {
                namespace: "Alexa.Discovery",
                name: "DeleteReport",
                payloadVersion: "3",
                messageId: msgId()
              },
              payload: {
                endpoints: [{ endpointId }],
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
            const errBody = await alexaRes.text();
            console.warn(`DELETE_REPORT_FAIL: ${alexaRes.status} body=${errBody}`);
          } else {
            console.log(`DELETE_REPORT_SENT: ${endpointId} no longer exists, notified Alexa`);
          }
        }
      } catch (delErr) {
        console.error(`DELETE_REPORT_ERROR: ${delErr.message}`);
      }

      return errorResponse("NO_SUCH_ENDPOINT", "Device not found", correlationToken);
    }

    let props = item.state?.properties || [];

    if (props.length === 0) {
       props = [{
         namespace: "Alexa.PowerController",
         name: "powerState",
         value: "OFF",
         timeOfSample: new Date().toISOString(),
         uncertaintyInMilliseconds: 1000
       }];
    }

    await markDeviceActive(clientId, endpointId);

    return {
      context: { properties: props },
      event: {
        header: {
          namespace: "Alexa",
          name: "StateReport",
          payloadVersion: "3",
          messageId: msgId(),
          correlationToken: correlationToken,
        },
        endpoint: { endpointId },
        payload: {},
      },
    };
  } catch (err) {
    console.error("REPORT_STATE_ERROR", err);
    return errorResponse("INTERNAL_ERROR", "Internal Error", correlationToken);
  }
}

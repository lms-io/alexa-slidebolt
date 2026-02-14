import { db, DEVICES_TABLE } from '../../lib/dynamo.mjs';
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { msgId, errorResponse } from '../../lib/alexa/response.mjs';
import { markDeviceActive } from '../../lib/alexa/directives.mjs';

export async function handleReportState(clientId, directive) {
  const endpointId = directive.endpoint?.endpointId;
  const correlationToken = directive.header.correlationToken;

  if (!endpointId) return errorResponse("INVALID_DIRECTIVE", "Missing endpointId", correlationToken);

  try {
    const res = await db(DEVICES_TABLE).get({
      clientId: clientId,
      sk: `device#${endpointId}`
    });
    
    const item = res.Item ? unmarshall(res.Item) : null;
    let props = item?.state?.properties || [];

    if (props.length === 0) {
       props = [{
         namespace: "Alexa.PowerController",
         name: "powerState",
         value: "OFF",
         timeOfSample: new Date().toISOString(),
         uncertaintyInMilliseconds: 1000
       }];
    }

    if (item) await markDeviceActive(clientId, endpointId);

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

import { msgId, errorResponse } from '../../lib/alexa/response.mjs';
import { markDeviceActive, postDirectiveToClient } from '../../lib/alexa/directives.mjs';

export async function handleControl(clientId, directive) {
  const header = directive.header;
  const endpointId = directive.endpoint?.endpointId;
  const correlationToken = header.correlationToken;
  const ns = header.namespace;
  const name = header.name;

  if (!endpointId) return errorResponse("INVALID_DIRECTIVE", "Missing endpointId", correlationToken);

  // 1. Forward to Client
  await postDirectiveToClient(clientId, directive);
  await markDeviceActive(clientId, endpointId);

  // 2. Build Optimistic Response
  const contextProps = [];
  const now = new Date().toISOString();

  const addProp = (pNs, pName, val) => {
    contextProps.push({
      namespace: pNs,
      name: pName,
      value: val,
      timeOfSample: now,
      uncertaintyInMilliseconds: 200
    });
  };

  if (ns === "Alexa.PowerController") {
    if (name === "TurnOn") addProp(ns, "powerState", "ON");
    if (name === "TurnOff") addProp(ns, "powerState", "OFF");
  } else if (ns === "Alexa.BrightnessController" && name === "SetBrightness") {
    addProp(ns, "brightness", directive.payload.brightness);
  } else if (ns === "Alexa.ColorController" && name === "SetColor") {
    addProp(ns, "color", directive.payload.color);
  } else if (ns === "Alexa.ColorTemperatureController" && name === "SetColorTemperature") {
    addProp(ns, "colorTemperatureInKelvin", directive.payload.colorTemperatureInKelvin);
  }

  return {
    context: contextProps.length ? { properties: contextProps } : undefined,
    event: {
      header: {
        namespace: "Alexa",
        name: "Response",
        payloadVersion: "3",
        messageId: msgId(),
        correlationToken: correlationToken,
      },
      endpoint: { endpointId },
      payload: {},
    },
  };
}

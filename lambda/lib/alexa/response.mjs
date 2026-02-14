import { randomUUID } from "node:crypto";

export function msgId() {
  return randomUUID();
}

export function errorResponse(type, message, correlationToken) {
  const hdr = {
    namespace: "Alexa",
    name: "ErrorResponse",
    payloadVersion: "3",
    messageId: msgId(),
  };
  if (correlationToken) hdr.correlationToken = correlationToken;
  return {
    event: {
      header: hdr,
      payload: { type, message },
    },
  };
}

export function successResponse(namespace, name, payload, correlationToken, endpointId) {
  const hdr = {
    namespace: namespace,
    name: name,
    payloadVersion: "3",
    messageId: msgId(),
  };
  if (correlationToken) hdr.correlationToken = correlationToken;
  
  const event = {
    header: hdr,
    payload: payload || {}
  };

  if (endpointId) {
    event.endpoint = { endpointId };
  }

  return { event };
}

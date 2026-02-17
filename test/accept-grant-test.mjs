import { handler } from '../lambda/slideBoltSmartHome.mjs';

async function run() {
  console.log("=== Mock AcceptGrant Test ===");

  const payload = {
    directive: {
      header: {
        namespace: "Alexa.Authorization",
        name: "AcceptGrant",
        payloadVersion: "3",
        messageId: "mock-msg-123"
      },
      payload: {
        grant: {
          type: "OAuth2.AuthorizationCode",
          code: "mock-code-456"
        },
        grantee: {
          type: "BearerToken",
          token: "user-mock-user-789"
        }
      }
    }
  };

  console.log("Invoking handler with Mock AcceptGrant...");
  const response = await handler(payload);

  console.log("Response:", JSON.stringify(response, null, 2));

  if (response.event?.header?.name === "AcceptGrant.Response") {
    console.log("✅ SUCCESS: Received AcceptGrant.Response");
  } else {
    console.error("❌ FAIL: Did not receive AcceptGrant.Response");
  }
}

run().catch(console.error);

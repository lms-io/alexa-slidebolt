import { handler } from '../lambda/slideBoltReporter.mjs';

// Mock DynamoDB Stream Record
const createRecord = (oldState, newState, clientId = "test-client", deviceId = "lamp-1") => ({
  eventName: 'MODIFY',
  dynamodb: {
    OldImage: oldState ? {
      pk: { S: `CLIENT#${clientId}` },
      sk: { S: `DEVICE#${deviceId}` },
      clientId: { S: clientId },
      state: { M: Object.entries(oldState).reduce((acc, [k, v]) => ({ ...acc, [k]: { S: v } }), {}) }
    } : undefined,
    NewImage: {
      pk: { S: `CLIENT#${clientId}` },
      sk: { S: `DEVICE#${deviceId}` },
      clientId: { S: clientId },
      state: { M: Object.entries(newState).reduce((acc, [k, v]) => ({ ...acc, [k]: { S: v } }), {}) }
    }
  }
});

async function runTests() {
  console.log("=== Reporter Lambda Stream Filter Tests ===");

  // Test 1: Real Change
  console.log("\nTest 1: State Change (OFF -> ON)");
  const event1 = {
    Records: [createRecord({ powerState: "OFF" }, { powerState: "ON" })]
  };
  await handler(event1);

  // Test 2: Heartbeat (No Change)
  console.log("\nTest 2: Heartbeat (ON -> ON)");
  const event2 = {
    Records: [createRecord({ powerState: "ON" }, { powerState: "ON" })]
  };
  await handler(event2);

  // Test 3: Non-Device Item
  console.log("\nTest 3: Metadata Change (Should ignore)");
  const event3 = {
    Records: [{
      eventName: 'MODIFY',
      dynamodb: {
        NewImage: {
          pk: { S: "CLIENT#test-client" },
          sk: { S: "METADATA" }
        }
      }
    }]
  };
  await handler(event3);

  console.log("\n=== Stream Tests Complete ===");
}

runTests().catch(console.error);
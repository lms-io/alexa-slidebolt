import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const CLIENT_ID = "2cef8a6d-1a3e-4ca1-896f-8be67fbba997";
const TABLE_NAME = "SldBltData-v1-prod";

const devices = [
  {
    endpointId: "cert-lamp-1",
    friendlyName: "Living Room Lamp",
    displayCategories: ["LIGHT"],
    capabilities: [
      { interface: "Alexa", type: "AlexaInterface", version: "3" },
      { 
        interface: "Alexa.PowerController", 
        type: "AlexaInterface", 
        version: "3",
        properties: { supported: [{ name: "powerState" }], proactivelyReported: true, retrievable: true }
      },
      {
        interface: "Alexa.BrightnessController",
        type: "AlexaInterface",
        version: "3",
        properties: { supported: [{ name: "brightness" }], proactivelyReported: true, retrievable: true }
      }
    ]
  },
  {
    endpointId: "cert-switch-1",
    friendlyName: "Kitchen Light",
    displayCategories: ["SWITCH"],
    capabilities: [
      { interface: "Alexa", type: "AlexaInterface", version: "3" },
      { 
        interface: "Alexa.PowerController", 
        type: "AlexaInterface", 
        version: "3",
        properties: { supported: [{ name: "powerState" }], proactivelyReported: true, retrievable: true }
      }
    ]
  }
];

async function seed() {
  const now = new Date().toISOString();
  
  for (const dev of devices) {
    console.log(`Seeding device: ${dev.friendlyName}...`);
    
    // 1. Put Device Item
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `CLIENT#${CLIENT_ID}`,
        sk: `DEVICE#${dev.endpointId}`,
        clientId: CLIENT_ID,
        endpointId: dev.endpointId,
        endpoint: dev,
        state: {
          properties: [
            { namespace: "Alexa.PowerController", name: "powerState", value: "OFF", timeOfSample: now, uncertaintyInMilliseconds: 0 }
          ]
        },
        status: "active",
        firstSeen: now,
        updatedAt: now
      }
    }));
  }
  
  console.log("✅ Certification devices seeded successfully!");
}

seed().catch(console.error);

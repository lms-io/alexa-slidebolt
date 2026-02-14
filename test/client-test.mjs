import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// --- Configuration ---
const ROOT_ENV = path.join(process.cwd(), '.env');
const TEST_ENV = path.join(process.cwd(), 'test', '.env.test');

function loadEnv(filepath) {
  if (!fs.existsSync(filepath)) return {};
  const creds = {};
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split('\n');
  for (let line of lines) {
    line = line.replace('\r', '').trim();
    if (line && !line.startsWith('#')) {
      const idx = line.indexOf('=');
      if (idx !== -1) {
        const k = line.slice(0, idx).trim();
        let v = line.slice(idx + 1).trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        creds[k] = v;
      }
    }
  }
  return creds;
}

const rootConfig = loadEnv(ROOT_ENV);
const testConfig = loadEnv(TEST_ENV);

const WS_URL = testConfig.TEST_WS_URL || process.env.TEST_WS_URL;
const ADMIN_SECRET = rootConfig.WS_SHARED_SECRET || process.env.WS_SHARED_SECRET;

if (!WS_URL) {
  console.error("Missing TEST_WS_URL");
  process.exit(1);
}

// --- Helper: Promisified WebSocket Client ---
class TestClient {
  constructor(url, label) {
    this.url = url;
    this.label = label;
    this.ws = null;
    this.resolveNext = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => resolve());
      this.ws.on('message', (data) => {
        const str = data.toString();
        if (this.resolveNext) {
          const r = this.resolveNext;
          this.resolveNext = null;
          try {
             r(JSON.parse(str));
          } catch(e) {
             console.error("Failed to parse response:", str);
             r({ error: "Invalid JSON" });
          }
        }
      });
      this.ws.on('error', (err) => {
        console.error(`[${this.label}] Error:`, err.message);
        reject(err);
      });
    });
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  async sendAndAwait(obj) {
    this.send(obj);
    return new Promise((resolve) => {
      this.resolveNext = resolve;
      setTimeout(() => {
        if (this.resolveNext === resolve) {
          this.resolveNext = null;
          resolve({ timeout: true });
        }
      }, 5000);
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// --- Test Runner ---
async function run() {
  console.log("=== Client Device Lifecycle Test ===");
  
  // 1. Admin Setup
  console.log("\n--- Admin: Create Client ---");
  const admin = new TestClient(WS_URL, "Admin");
  await admin.connect();

  const testLabel = `DevTest ${randomUUID().substring(0,8)}`;
  const clientCreds = await admin.sendAndAwait({
    action: "admin_create_client",
    auth: { token: ADMIN_SECRET },
    label: testLabel,
    maxMsgsPerMinute: 60
  });

  if (!clientCreds.ok || !clientCreds.clientId) {
    console.error("❌ Fail: Could not create client", clientCreds);
    admin.close();
    process.exit(1);
  }
  
  console.log(`✅ Pass: Created Client ${clientCreds.clientId}`);
  admin.close();

  // 2. Connect as Client
  console.log("\n--- Client: Connect & Register ---");
  const client = new TestClient(WS_URL, "Client");
  await client.connect();

  const regRes = await client.sendAndAwait({
    action: "register",
    clientId: clientCreds.clientId,
    secret: clientCreds.secret
  });

  if (regRes.status !== 'ok') {
    console.error("❌ Fail: Registration failed", regRes);
    client.close();
    process.exit(1);
  }
  console.log("✅ Pass: Registered");

  // 3. Create Device (Upsert)
  console.log("\n--- Client: Create Device (Upsert) ---");
  const endpointId = "device-1";
  const upsertRes = await client.sendAndAwait({
    action: "device_upsert",
    clientId: clientCreds.clientId,
    endpoint: {
      endpointId: endpointId,
      friendlyName: "Test Lamp",
      description: "A virtual lamp",
      manufacturerName: "TestCo",
      displayCategories: ["LIGHT"],
      capabilities: []
    },
    state: { powerState: "OFF" }
  });

  if (upsertRes.ok) {
    console.log("✅ Pass: Upsert OK");
  } else {
    console.error("❌ Fail: Upsert failed", upsertRes);
  }

  // 4. List Devices (Verify)
  console.log("\n--- Client: List Devices ---");
  const listRes = await client.sendAndAwait({
    action: "list_devices",
    clientId: clientCreds.clientId
  });

  if (listRes.ok && Array.isArray(listRes.devices)) {
    const dev = listRes.devices.find(d => d.endpointId === endpointId);
    if (dev) {
       console.log("✅ Pass: Device found");
       if (dev.state && dev.state.powerState === "OFF") {
         console.log("✅ Pass: State matches (OFF)");
       } else {
         console.error("❌ Fail: State mismatch", dev.state);
       }
    } else {
       console.error("❌ Fail: Device not found in list", listRes);
    }
  } else {
    console.error("❌ Fail: List failed", listRes);
  }

  // 5. Update Device State
  console.log("\n--- Client: Update State (ON) ---");
  const updateRes = await client.sendAndAwait({
    action: "state_update",
    clientId: clientCreds.clientId,
    deviceId: endpointId,
    state: { powerState: "ON" }
  });

  if (updateRes.ok) {
    console.log("✅ Pass: Update OK");
  } else {
    console.error("❌ Fail: Update failed", updateRes);
  }

  // 6. Verify Update
  console.log("\n--- Client: Verify Update ---");
  const listRes2 = await client.sendAndAwait({
    action: "list_devices",
    clientId: clientCreds.clientId
  });

  const dev2 = listRes2.devices.find(d => d.endpointId === endpointId);
  if (dev2 && dev2.state && dev2.state.powerState === "ON") {
    console.log("✅ Pass: State updated to ON");
  } else {
    console.error("❌ Fail: State update not reflected", dev2);
  }

  // 7. Delete Device
  console.log("\n--- Client: Delete Device ---");
  const delRes = await client.sendAndAwait({
    action: "delete_device",
    clientId: clientCreds.clientId,
    deviceId: endpointId
  });

  if (delRes.ok) {
    console.log("✅ Pass: Delete OK");
  } else {
    console.error("❌ Fail: Delete failed", delRes);
  }

  // 8. Verify Deletion
  console.log("\n--- Client: Verify Deletion ---");
  const listRes3 = await client.sendAndAwait({
    action: "list_devices",
    clientId: clientCreds.clientId
  });

  if (listRes3.ok && listRes3.devices.length === 0) {
    console.log("✅ Pass: Device list empty");
  } else {
    console.error("❌ Fail: Device list not empty", listRes3.devices);
  }

  client.close();

  // 9. Admin Teardown
  console.log("\n--- Admin: Cleanup Client ---");
  const admin2 = new TestClient(WS_URL, "Admin");
  await admin2.connect();
  const deleteClientRes = await admin2.sendAndAwait({
    action: "admin_delete_client",
    auth: { token: ADMIN_SECRET },
    clientId: clientCreds.clientId
  });

  if (deleteClientRes.ok) {
    console.log("✅ Pass: Client Deleted");
  } else {
    console.error("❌ Fail: Client deletion failed", deleteClientRes);
  }
  admin2.close();

  console.log("\n=== Client Device Lifecycle Test Complete ===");
}

run().catch(err => console.error(err));
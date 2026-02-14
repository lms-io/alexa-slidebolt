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
  console.error("Missing TEST_WS_URL in test/.env.test or environment");
  process.exit(1);
}
if (!ADMIN_SECRET) {
  console.error("Missing WS_SHARED_SECRET in .env or environment");
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
  console.log("=== Admin Test Suite ===");
  console.log(`Target: ${WS_URL}`);
  
  const client = new TestClient(WS_URL, "Admin");
  await client.connect();

  // 0. Negative Testing
  console.log("\n--- Phase 0: Negative Testing (Auth) ---");

  // 0.1 No Auth
  console.log("Test 0.1: No Auth Object...");
  const res01 = await client.sendAndAwait({
    action: "admin_list_clients"
  });
  if (res01.error && res01.error.includes("Unauthorized")) {
    console.log("✅ Pass: Blocked (No Auth)");
  } else {
    console.error("❌ Fail: Expected Unauthorized, got", res01);
  }

  // 0.2 Empty Token
  console.log("Test 0.2: Empty Token...");
  const res02 = await client.sendAndAwait({
    action: "admin_list_clients",
    auth: { token: "" }
  });
  if (res02.error && res02.error.includes("Unauthorized")) {
    console.log("✅ Pass: Blocked (Empty Token)");
  } else {
    console.error("❌ Fail: Expected Unauthorized, got", res02);
  }

  // 0.3 Invalid Token
  console.log("Test 0.3: Invalid Token...");
  const res03 = await client.sendAndAwait({
    action: "admin_list_clients",
    auth: { token: "wrong-secret-xyz" }
  });
  if (res03.error && res03.error.includes("Unauthorized")) {
    console.log("✅ Pass: Blocked (Invalid Token)");
  } else {
    console.error("❌ Fail: Expected Unauthorized, got", res03);
  }


  // --- Functional Testing ---
  console.log("\n--- Phase 1: Functional CRUD ---");

  const testLabel = `Test Client ${randomUUID()}`;
  let newClientId = null;

  // 1. Create Client
  console.log(`Test 1: Create Client "${testLabel}"...`);
  const createRes = await client.sendAndAwait({
    action: "admin_create_client",
    auth: { token: ADMIN_SECRET },
    label: testLabel,
    maxMsgsPerMinute: 80
  });

  if (createRes.ok && createRes.clientId) {
    console.log("✅ Pass: Client Created");
    newClientId = createRes.clientId;
    console.log(`   ID: ${newClientId}`);
  } else {
    console.error("❌ Fail: Create failed", createRes);
    client.close();
    process.exit(1);
  }

  // 2. List Clients (Verify Existence)
  console.log(`Test 2: List Clients and find ID...`);
  const listRes = await client.sendAndAwait({
    action: "admin_list_clients",
    auth: { token: ADMIN_SECRET }
  });

  if (listRes.ok && Array.isArray(listRes.clients)) {
    const found = listRes.clients.find(c => c.clientId === newClientId);
    if (found) {
      console.log("✅ Pass: Client found in list");
      if (found.maxMsgsPerMinute === 80) console.log("   (Rate limit matched)");
      else console.warn("   ⚠️ Rate limit mismatch:", found.maxMsgsPerMinute);
    } else {
      console.error("❌ Fail: Client ID not found in list");
    }
  } else {
    console.error("❌ Fail: List failed", listRes);
  }

  // 3. Update Client
  console.log(`Test 3: Update Client (Rate Limit -> 100)...`);
  const updateRes = await client.sendAndAwait({
    action: "admin_update_client",
    auth: { token: ADMIN_SECRET },
    clientId: newClientId,
    maxMsgsPerMinute: 100
  });

  if (updateRes.ok) {
     console.log("✅ Pass: Update OK");
     
     // Double check update persistence
     const list2 = await client.sendAndAwait({
       action: "admin_list_clients",
       auth: { token: ADMIN_SECRET }
     });
     const found2 = list2.clients.find(c => c.clientId === newClientId);
     if (found2 && found2.maxMsgsPerMinute === 100) {
       console.log("✅ Pass: Update verified in list");
     } else {
       console.error("❌ Fail: Update not persisted", found2);
     }

  } else {
    console.error("❌ Fail: Update failed", updateRes);
  }

  // 4. Delete Client
  console.log(`Test 4: Delete Client...`);
  const deleteRes = await client.sendAndAwait({
    action: "admin_delete_client",
    auth: { token: ADMIN_SECRET },
    clientId: newClientId
  });

  if (deleteRes.ok && deleteRes.status === 'deleted') {
    console.log("✅ Pass: Delete OK");
  } else {
    console.error("❌ Fail: Delete failed", deleteRes);
  }

  // 5. Verify Deletion
  console.log(`Test 5: Verify Deletion...`);
  const finalRes = await client.sendAndAwait({
    action: "admin_list_clients",
    auth: { token: ADMIN_SECRET }
  });

  const finalClient = finalRes.clients.find(c => c.clientId === newClientId);
  if (!finalClient) {
    console.log("✅ Pass: Client not found in list");
  } else {
    console.error("❌ Fail: Client still exists", finalClient);
  }

  client.close();
  console.log("\n=== Admin Test Suite Complete ===");
}

run().catch(err => console.error(err));

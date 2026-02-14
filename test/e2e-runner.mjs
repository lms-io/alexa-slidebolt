import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

// --- Load .env.test manually ---
const ENV_PATH = path.join(process.cwd(), 'test', '.env.test');
if (fs.existsSync(ENV_PATH)) {
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const k = trimmed.slice(0, idx).trim();
        let v = trimmed.slice(idx + 1).trim();
        // Remove quotes if present
        if (v.startsWith('"') && v.endsWith('"')) {
          v = v.slice(1, -1);
        }
        process.env[k] = v;
      }
    }
  });
}

const WS_URL = process.env.TEST_WS_URL;
const HOME1 = {
  clientId: process.env.TEST_HOME1_CLIENT_ID,
  secret: process.env.TEST_HOME1_SECRET,
  label: process.env.TEST_HOME1_LABEL
};
const HOME2 = {
  clientId: process.env.TEST_HOME2_CLIENT_ID,
  secret: process.env.TEST_HOME2_SECRET,
  label: process.env.TEST_HOME2_LABEL
};

if (!WS_URL || !HOME1.clientId || !HOME2.clientId) {
  console.error("Missing configuration in test/.env.test");
  process.exit(1);
}

// --- Helper: Promisified WebSocket Client ---
class TestClient {
  constructor(url, label) {
    this.url = url;
    this.label = label;
    this.ws = null;
    this.msgs = [];
    this.resolveNext = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => {
        resolve();
      });
      this.ws.on('message', (data) => {
        const str = data.toString();
        // console.log(`[${this.label}] Recv: ${str}`);
        if (this.resolveNext) {
          const r = this.resolveNext;
          this.resolveNext = null;
          r(JSON.parse(str));
        } else {
          this.msgs.push(JSON.parse(str));
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
      // Timeout fallback
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
  console.log("=== Loading Credentials from .env.test ===");
  console.log(`Target: ${WS_URL}`);
  console.log(`Home 1: ${HOME1.clientId}`);
  console.log(`Home 2: ${HOME2.clientId}`);

  // ==========================================
  // PHASE A: NEGATIVE TESTING (The Intruder)
  // ==========================================
  console.log("\n=== Phase A: Negative Testing ===");
  
  const intruder = new TestClient(WS_URL, "Intruder");
  await intruder.connect();

  // Test 1: Invalid Secret
  console.log("Test A.1: Register with wrong secret...");
  const resA1 = await intruder.sendAndAwait({
    action: "register",
    clientId: HOME1.clientId,
    secret: "wrong-secret-123"
  });
  if (resA1.statusCode === 403) console.log("✅ Pass: Got 403 Forbidden");
  else console.error("❌ Fail: Expected 403, got", resA1);

  // Test 2: Invalid ClientID
  console.log("Test A.2: Register with random ClientID...");
  const resA2 = await intruder.sendAndAwait({
    action: "register",
    clientId: "random-uuid-999",
    secret: "some-secret"
  });
  if (resA2.statusCode === 403) console.log("✅ Pass: Got 403 Forbidden (Invalid Client)");
  else console.error("❌ Fail: Expected 403, got", resA2);

  intruder.close();

  // ==========================================
  // PHASE B: FUNCTIONAL TESTING (Good Client)
  // ==========================================
  console.log("\n=== Phase B: Functional Testing ===");
  
  const client1 = new TestClient(WS_URL, "Home1");
  await client1.connect();

  // Test 1: Valid Register
  console.log("Test B.1: Valid Registration...");
  const resB1 = await client1.sendAndAwait({
    action: "register",
    clientId: HOME1.clientId,
    secret: HOME1.secret
  });
  if (resB1.statusCode === 200) console.log("✅ Pass: Got 200 OK");
  else console.error("❌ Fail: Expected 200, got", resB1);

  // Test 2: Device Upsert
  console.log("Test B.2: Device Upsert...");
  const resB2 = await client1.sendAndAwait({
    action: "device_upsert",
    clientId: HOME1.clientId,
    endpoint: {
      endpointId: "lamp-1",
      friendlyName: "Hall Lamp"
    },
    state: { powerState: "OFF" }
  });
  if (resB2.statusCode === 200) console.log("✅ Pass: Upsert OK");
  else console.error("❌ Fail: Expected 200, got", resB2);

  // Test 3: State Update
  console.log("Test B.3: State Update...");
  const resB3 = await client1.sendAndAwait({
    action: "state_update",
    clientId: HOME1.clientId,
    deviceId: "lamp-1",
    state: { powerState: "ON" }
  });
  if (resB3.statusCode === 200) console.log("✅ Pass: State Update OK");
  else console.error("❌ Fail: Expected 200, got", resB3);

  // ==========================================
  // PHASE C: ISOLATION TESTING (Spoofing)
  // ==========================================
  console.log("\n=== Phase C: Isolation Testing ===");
  
  console.log("Test C.1: Spoofing Home 2...");
  const resC1 = await client1.sendAndAwait({
    action: "state_update",
    clientId: HOME2.clientId,
    deviceId: "lamp-1",
    state: { powerState: "EVIL" }
  });

  if (resC1.statusCode === 200) {
    console.warn("⚠️  WARNING: Spoofing succeeded! Authentication is NOT enforced on data actions.");
  } else {
    console.log("✅ Pass: Spoofing blocked (Unexpected but good!)");
  }

  client1.close();
  console.log("\n=== Test Suite Complete ===");
}

run().catch(err => console.error(err));
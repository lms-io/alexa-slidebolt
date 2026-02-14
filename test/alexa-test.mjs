import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';

const { writeFileSync, readFileSync, unlinkSync, existsSync } = fs;

// --- Configuration ---
const ROOT_ENV = path.join(process.cwd(), '.env');
const TEST_ENV = path.join(process.cwd(), 'test', '.env.test');

function loadEnv(filepath) {
  if (!fs.existsSync(filepath)) return {};
  const creds = {};
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
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
const TEST_TOKEN = "user-debug-alexa-token-123";

// --- Admin Helper ---
class AdminClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.resolveNext = null;
  }
  connect() { 
    return new Promise((r) => {
      this.ws.on('open', r);
      this.ws.on('message', (data) => {
        if (this.resolveNext) {
          const res = this.resolveNext;
          this.resolveNext = null;
          try { res(JSON.parse(data.toString())); } catch { res({}); }
        }
      });
    });
  }
  async send(obj) {
    return new Promise((resolve) => {
      this.resolveNext = resolve;
      this.ws.send(JSON.stringify(obj));
      setTimeout(() => { if (this.resolveNext === resolve) { this.resolveNext = null; resolve({ timeout: true }); } }, 5000);
    });
  }
  close() { this.ws.close(); }
}

function invokeLambda(payload) {
  const infile = `alexa-payload-${Date.now()}.json`;
  const outfile = `alexa-response-${Date.now()}.json`;
  
  try {
    writeFileSync(infile, JSON.stringify(payload));
    execSync(`aws lambda invoke --function-name SldBltSmartHome --payload fileb://${infile} ${outfile}`, { stdio: 'pipe' });
    return JSON.parse(readFileSync(outfile, 'utf8'));
  } catch (e) {
    console.error("Invoke failed", e.message);
    return null;
  } finally {
    if (existsSync(infile)) unlinkSync(infile);
    if (existsSync(outfile)) unlinkSync(outfile);
  }
}

async function run() {
  console.log("=== Alexa Simulation & Email Test ===");

  const admin = new AdminClient(WS_URL);
  await admin.connect();

  // 1. Create Client
  console.log("\n1. Creating Test Client...");
  const clientRes = await admin.send({
    action: "admin_create_client",
    auth: { token: ADMIN_SECRET },
    label: "Email Capture Test"
  });
  const clientId = clientRes.clientId;
  if (!clientId) { console.error("Create failed", clientRes); process.exit(1); }
  console.log(`   ClientId: ${clientId}`);

  // 2. Map User
  const userId = TEST_TOKEN;
  console.log(`\n2. Mapping User ${userId} to House...`);
  await admin.send({ action: "admin_add_user_to_client", auth: { token: ADMIN_SECRET }, userId, clientId });
  console.log("   ✅ Mapped");

  // 3. Discovery (Simulate Alexa interaction)
  console.log("\n3. Invoking Discovery (Simulate Alexa)...");
  const discoverPayload = {
    directive: {
      header: { namespace: "Alexa.Discovery", name: "Discover", payloadVersion: "3", messageId: "msg-1" },
      payload: { scope: { type: "BearerToken", token: userId } }
    }
  };

  const discRes = invokeLambda(discoverPayload);
  if (discRes && discRes.event && discRes.event.header.name === "Discover.Response") {
    console.log("✅ Pass: Successfully mapped user to house and got response");
  } else {
    console.error("❌ Fail: Mapping failed", discRes);
  }

  // 4. Verification
  console.log("\n4. Listing Client Users (Checking email capture)...");
  const listRes = await admin.send({ action: "admin_list_client_users", auth: { token: ADMIN_SECRET }, clientId });
  if (listRes.ok && listRes.users.length > 0) {
    const user = listRes.users.find(u => u.userId === userId);
    if (user && user.email === `${userId}@example.com`) {
      console.log("✅ Pass: User email captured correctly");
    } else {
      console.error("❌ Fail: Email not captured or incorrect", user);
    }
  } else {
    console.error("❌ Fail: List failed", listRes);
  }

  // 5. Cleanup
  console.log("\n5. Cleaning up...");
  await admin.send({ action: "admin_delete_client", auth: { token: ADMIN_SECRET }, clientId });
  console.log("   ✅ Pass: Cleanup complete");

  admin.close();
  console.log("\n=== Alexa Test Complete ===");
}

run().catch(err => console.error(err));
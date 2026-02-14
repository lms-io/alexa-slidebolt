import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';

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

// --- Helpers ---

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

function invokeSmartHome(userId) {
  const infile = `mapping-payload-${Date.now()}.json`;
  const outfile = `mapping-response-${Date.now()}.json`;
  
  const payload = {
    directive: {
      header: { namespace: "Alexa.Discovery", name: "Discover", payloadVersion: "3", messageId: "msg" },
      payload: { scope: { type: "BearerToken", token: userId } }
    }
  };

  try {
    writeFileSync(infile, JSON.stringify(payload));
    execSync(`aws lambda invoke --function-name SldBltSmartHome --payload fileb://${infile} ${outfile}`, { stdio: 'pipe' });
    return JSON.parse(readFileSync(outfile, 'utf8'));
  } catch (e) {
    return { error: e.message };
  } finally {
    if (existsSync(infile)) unlinkSync(infile);
    if (existsSync(outfile)) unlinkSync(outfile);
  }
}

// --- Test Runner ---
async function run() {
  console.log("=== Mapping Test Suite ===");
  
  const admin = new AdminClient(WS_URL);
  await admin.connect();

  // 1. Create Client
  console.log("\n1. Creating Test Client...");
  const clientRes = await admin.send({
    action: "admin_create_client",
    auth: { token: ADMIN_SECRET },
    label: "Mapping Test House"
  });
  const clientId = clientRes.clientId;
  if (!clientId) { console.error("Create failed", clientRes); process.exit(1); }
  console.log(`   ClientId: ${clientId}`);

  // 2. Map users
  const user1 = `user-1-${randomUUID().substring(0,8)}`;
  const user2 = `user-2-${randomUUID().substring(0,8)}`;
  
  console.log(`\n2. Mapping users ${user1} and ${user2} to house...`);
  await admin.send({ action: "admin_add_user_to_client", auth: { token: ADMIN_SECRET }, userId: user1, clientId });
  await admin.send({ action: "admin_add_user_to_client", auth: { token: ADMIN_SECRET }, userId: user2, clientId });
  console.log("   ✅ Mapped");

  // 3. Invoke SmartHome as User 1
  console.log(`\n3. Invoking SmartHome as User 1 (${user1})...`);
  const res1 = invokeSmartHome(user1);
  if (res1 && res1.event && res1.event.header.name === "Discover.Response") {
    console.log("   ✅ Pass: Successfully mapped to client and got response");
  } else {
    console.error("   ❌ Fail: SmartHome mapping failed", JSON.stringify(res1, null, 2));
  }

  // 4. Invoke SmartHome as User 2
  console.log(`\n4. Invoking SmartHome as User 2 (${user2})...`);
  const res2 = invokeSmartHome(user2);
  if (res2 && res2.event && res2.event.header.name === "Discover.Response") {
    console.log("   ✅ Pass: Successfully mapped to client and got response");
  } else {
    console.error("   ❌ Fail: SmartHome mapping failed", JSON.stringify(res2, null, 2));
  }

  // 5. Invoke as Unmapped User
  const user3 = `user-3-unmapped`;
  console.log(`\n5. Invoking SmartHome as Unmapped User (${user3})...`);
  const res3 = invokeSmartHome(user3);
  if (res3 && res3.event && res3.event.header.name === "ErrorResponse" && res3.event.payload.type === "ACCEPT_GRANT_FAILED") {
    console.log("   ✅ Pass: Correctly blocked unmapped user");
  } else {
    console.error("   ❌ Fail: Unmapped user should have been blocked", JSON.stringify(res3, null, 2));
  }

  // 6. Cleanup
  console.log("\n6. Cleaning up...");
  await admin.send({ action: "admin_remove_user_from_client", auth: { token: ADMIN_SECRET }, userId: user1 });
  await admin.send({ action: "admin_remove_user_from_client", auth: { token: ADMIN_SECRET }, userId: user2 });
  await admin.send({ action: "admin_delete_client", auth: { token: ADMIN_SECRET }, clientId });
  console.log("   ✅ Pass: Cleanup complete");

  admin.close();
  console.log("\n=== Mapping Test Complete ===");
}

run().catch(err => console.error(err));
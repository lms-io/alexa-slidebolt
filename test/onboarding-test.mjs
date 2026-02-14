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

function invokeSmartHome(token) {
  const infile = `onboarding-payload-${Date.now()}.json`;
  const outfile = `onboarding-response-${Date.now()}.json`;
  const payload = {
    directive: {
      header: { namespace: "Alexa.Discovery", name: "Discover", payloadVersion: "3", messageId: "msg" },
      payload: { scope: { type: "BearerToken", token } }
    }
  };
  try {
    writeFileSync(infile, JSON.stringify(payload));
    execSync(`aws lambda invoke --function-name SldBltSmartHome --payload fileb://${infile} ${outfile}`, { stdio: 'pipe' });
    return JSON.parse(readFileSync(outfile, 'utf8'));
  } catch (e) { return { error: e.message }; }
  finally { if (existsSync(infile)) unlinkSync(infile); if (existsSync(outfile)) unlinkSync(outfile); }
}

// --- Test Runner ---
async function run() {
  console.log("=== Self-Service Onboarding Test Suite ===");
  
  const admin = new AdminClient(WS_URL);
  await admin.connect();

  const ownerEmail = `owner-${randomUUID().substring(0,8)}@test.com`;
  
  // 1. Create Client with Email
  console.log(`\n1. Creating Client for ${ownerEmail}...`);
  const clientRes = await admin.send({
    action: "admin_create_client",
    auth: { token: ADMIN_SECRET },
    label: "Onboarding House",
    ownerEmail: ownerEmail
  });
  const clientId = clientRes.clientId;
  if (!clientId) { console.error("Create failed", clientRes); process.exit(1); }
  console.log(`   ✅ Created: ${clientId}`);

  // 2. First Claim (Successful)
  const userId1 = `user-1-${randomUUID().substring(0,8)}`;
  const token1 = `${userId1}|${ownerEmail}`; 
  console.log(`\n2. User 1 claiming house (id=${userId1}, email=${ownerEmail})...`);
  
  const res1 = invokeSmartHome(token1);
  if (res1.event?.header?.name === "Discover.Response") {
    console.log("   ✅ Pass: Claim successful");
  } else {
    console.error("   ❌ Fail: Claim failed", JSON.stringify(res1, null, 2));
  }

  // 3. Squatter Attempt (Same Email, Different ID)
  const userId2 = `user-squatter-${randomUUID().substring(0,8)}`;
  const token2 = `${userId2}|${ownerEmail}`; 
  console.log(`\n3. Squatter Attempt (id=${userId2}, same email=${ownerEmail})...`);
  
  const res2 = invokeSmartHome(token2);
  if (res2.event?.header?.name === "ErrorResponse" && res2.event.payload.type === "ACCEPT_GRANT_FAILED") {
    console.log("   ✅ Pass: Squatter correctly blocked");
  } else {
    console.error("   ❌ Fail: Squatter should have been blocked", JSON.stringify(res2, null, 2));
  }

  // 4. Stranger Attempt (Different Email)
  const strangerEmail = "stranger@danger.com";
  const userId3 = "user-stranger";
  const token3 = `${userId3}|${strangerEmail}`;
  console.log(`\n4. Stranger Attempt (email=${strangerEmail})...`);
  
  const res3 = invokeSmartHome(token3);
  if (res3.event?.header?.name === "ErrorResponse" && res3.event.payload.type === "ACCEPT_GRANT_FAILED") {
    console.log("   ✅ Pass: Stranger correctly blocked");
  } else {
    console.error("   ❌ Fail: Stranger should have been blocked", JSON.stringify(res3, null, 2));
  }

  // 5. Cleanup
  console.log("\n5. Cleanup...");
  await admin.send({ action: "admin_delete_client", auth: { token: ADMIN_SECRET }, clientId });
  console.log("   ✅ Pass: Cleanup complete");

  admin.close();
  console.log("\n=== Onboarding Test Complete ===");
}

run().catch(err => console.error(err));
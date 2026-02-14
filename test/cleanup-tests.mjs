import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const TEST_ENV = path.join(process.cwd(), 'test', '.env.test');
const ROOT_ENV = path.join(process.cwd(), '.env');

function loadEnv(filepath) {
  if (!fs.existsSync(filepath)) return {};
  const creds = {};
  const content = fs.readFileSync(filepath, 'utf8');
  // Safe split using regex
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

const testConfig = loadEnv(TEST_ENV);
const rootConfig = loadEnv(ROOT_ENV);
const WS_URL = testConfig.TEST_WS_URL || process.env.TEST_WS_URL;
const ADMIN_SECRET = rootConfig.WS_SHARED_SECRET || process.env.WS_SHARED_SECRET;

class AdminClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.resolveNext = null;
  }

  connect() {
    return new Promise((resolve) => {
      this.ws.on('open', resolve);
      this.ws.on('message', (data) => {
        if (this.resolveNext) {
          const r = this.resolveNext;
          this.resolveNext = null;
          try { r(JSON.parse(data.toString())); } catch { r({}); }
        }
      });
    });
  }

  send(obj) {
    return new Promise((resolve) => {
      this.resolveNext = resolve;
      this.ws.send(JSON.stringify(obj));
      setTimeout(() => {
        if (this.resolveNext === resolve) {
          this.resolveNext = null;
          resolve({ error: 'timeout' });
        }
      }, 5000);
    });
  }

  close() {
    this.ws.close();
  }
}

async function clean() {
  console.log("Cleaning up test clients...");
  const admin = new AdminClient(WS_URL);
  await admin.connect();

  const list = await admin.send({ action: "admin_list_clients", auth: { token: ADMIN_SECRET } });
  if (!list.ok || !list.clients) {
    console.error("Failed to list clients", list);
    process.exit(1);
  }

  const targets = list.clients.filter(c => c.label.startsWith("Test Client") || c.label.startsWith("DevTest"));
  console.log(`Found ${targets.length} test clients to delete.`);

  for (const c of targets) {
    console.log(`Deleting ${c.label} (${c.clientId})...`);
    await admin.send({
      action: "admin_delete_client",
      auth: { token: ADMIN_SECRET },
      clientId: c.clientId
    });
  }

  console.log("Cleanup complete.");
  admin.close();
}

clean();
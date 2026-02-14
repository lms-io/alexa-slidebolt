#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// Load .env
const ROOT_ENV = join(process.cwd(), '.env');
if (existsSync(ROOT_ENV)) {
  const raw = readFileSync(ROOT_ENV, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = line.indexOf('=');
      if (idx !== -1) {
          const k = trimmed.slice(0, idx).trim();
          const v = trimmed.slice(idx + 1).trim();
          if (k && v && !process.env[k]) process.env[k] = v;
      }
    }
  }
}

const SECRET = process.env.WS_SHARED_SECRET;
if (!SECRET) {
  console.error("Error: WS_SHARED_SECRET not set in environment or .env");
  process.exit(1);
}

const label = process.argv[2];
const email = process.argv[3];

if (!label || !email) {
  console.log("Usage: node scripts/create-client.mjs \"Client Label\" \"owner@email.com\" [MaxMsgsPerMinute]");
  process.exit(1);
}

const limit = parseInt(process.argv[4] || '60', 10);

const payloadObj = {
  requestContext: { routeKey: 'admin_create_client' },
  body: JSON.stringify({
    action: 'admin_create_client',
    auth: { token: SECRET },
    label: label,
    ownerEmail: email,
    maxMsgsPerMinute: limit
  })
};

const payloadJson = JSON.stringify(payloadObj);
const outfile = 'admin-response.json';
const infile = 'payload.json';

console.log(`Creating client "${label}" for ${email}...`);

try {
  writeFileSync(infile, payloadJson);

  execSync(`aws lambda invoke --function-name SldBltAdmin --payload fileb://${infile} ${outfile}`, { stdio: 'inherit' });

  const response = JSON.parse(readFileSync(outfile, 'utf8'));
  
  if (existsSync(infile)) unlinkSync(infile);
  if (existsSync(outfile)) unlinkSync(outfile);

  if (response.statusCode !== 200) {
    console.error("Error from Lambda:", response);
    process.exit(1);
  }

  const body = JSON.parse(response.body);
  if (!body.ok) {
    console.error("Failed:", body);
    process.exit(1);
  }

  console.log("\n✅ Client Created Successfully!\n");
  console.log(`  ClientId:   ${body.clientId}`);
  console.log(`  Secret:     ${body.secret}`);
  console.log(`  Label:      ${label}`);
  console.log(`  OwnerEmail: ${email}`);
  console.log(`  RateLimit:  ${limit}/min`);
  console.log("\n⚠️  SAVE THE SECRET NOW. It cannot be retrieved later.\n");

} catch (err) {
  console.error("Execution failed:", err.message);
  process.exit(1);
}

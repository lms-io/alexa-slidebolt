#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/home/gavin/work/gotest/git/alexa-slidebolt';
const CDK_DIR = join(ROOT, 'cdk');
const SKILL_DIR = join(ROOT, 'skill');
const SKILL_PKG_DIR = join(SKILL_DIR, 'skill-package');
const SKILL_JSON = join(SKILL_PKG_DIR, 'skill.json');
const ROOT_ENV = join(ROOT, '.env');
const ASK_STATES = join(SKILL_DIR, '.ask', 'ask-states.json');
const ASK_RESOURCES = join(SKILL_DIR, 'ask-resources.json');
const CDK_ENV = join(CDK_DIR, '.env');

const REQUIRED_BINS = ['aws', 'cdk', 'node', 'npm', 'ask'];

// Ensure common paths are present for non-interactive shells.
process.env.PATH = [
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  process.env.PATH || '',
].filter(Boolean).join(':');

function loadEnvFile() {
  if (!existsSync(ROOT_ENV)) return;
  const raw = readFileSync(ROOT_ENV, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
}

function hasBin(bin) {
  const candidates = [
    `/usr/local/bin/${bin}`,
    `/usr/bin/${bin}`,
    `/bin/${bin}`,
  ];
  for (const p of candidates) {
    if (existsSync(p)) return true;
  }
  try {
    run(`which ${bin}`);
    return true;
  } catch {
    return false;
  }
}

function stepHeader(title) {
  process.stdout.write(`\n=== ${title} ===\n`);
}

function usage() {
  console.log(`Usage:
  node deploy-all.mjs --check
  node deploy-all.mjs --all
  node deploy-all.mjs --step1
  node deploy-all.mjs --step2
  node deploy-all.mjs --step3
  node deploy-all.mjs --step4
  node deploy-all.mjs --step5
  node deploy-all.mjs --step6
  node deploy-all.mjs --step7
  node deploy-all.mjs --step8
  node deploy-all.mjs --step9

Steps:
  --check  Verify required binaries and AWS identity/region
  --all    Run check + steps 1-6 + step8 (OAuth is separate)
  --step1  CDK bootstrap
  --step2  Deploy CDK stack (./deploy.sh)
  --step3  Print CDK outputs
  --step4  Create ASK skill (manual) and store Skill ID
  --step5  Patch skill.json with Lambda ARN
  --step6  Ensure Lambda permission for Smart Home
  --step7  Deploy Alexa skill (ask deploy)
  --step8  Verify Lambda policy + skill manifest
  --step9  Print OAuth (LWA) settings for Alexa console
`);
}

function requireDir(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }
}

function getRegion() {
  const region = run('aws configure get region');
  return region || 'us-east-1';
}

function getAccount() {
  return run('aws sts get-caller-identity --query Account --output text');
}

function stepCheck() {
  stepHeader('Check Required Binaries');
  console.log(`PATH: ${process.env.PATH}`);
  const missing = REQUIRED_BINS.filter((b) => !hasBin(b));
  if (missing.length) {
    console.log(`Missing: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('All required binaries found.');

  stepHeader('AWS Identity');
  console.log(run('aws sts get-caller-identity'));
  console.log(`Region: ${getRegion()}`);

  stepHeader('ASK Vendor');
  if (!process.env.ASK_VENDOR_ID) {
    console.log(`Missing ASK_VENDOR_ID. Add it to ${ROOT_ENV}:`);
    console.log('ASK_VENDOR_ID=M3K2CVID6C9D13');
    process.exit(1);
  }
  console.log(`ASK_VENDOR_ID: ${process.env.ASK_VENDOR_ID}`);
  if (process.env.ASK_SKILL_ID) {
    console.log(`ASK_SKILL_ID: ${process.env.ASK_SKILL_ID}`);
  }
}

function stepBootstrap() {
  stepHeader('CDK Bootstrap');
  requireDir(CDK_DIR, 'CDK dir');
  const region = getRegion();
  const account = getAccount();
  const cmd = `cdk bootstrap aws://${account}/${region}`;
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: CDK_DIR });
}

function stepDeploy() {
  stepHeader('CDK Deploy');
  requireDir(CDK_DIR, 'CDK dir');
  const cmd = './deploy.sh';
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: CDK_DIR });
}

function stepOutputs() {
  stepHeader('CDK Outputs');
  requireDir(CDK_DIR, 'CDK dir');
  const cmd =
    'aws cloudformation describe-stacks --stack-name SldBltProdStack ' +
    '--query "Stacks[0].Outputs" --output table';
  console.log(`$ ${cmd}`);
  console.log(run(cmd, { cwd: CDK_DIR }));
}

function stepCreateSkill() {
  stepHeader('Create ASK Skill');
  requireDir(SKILL_DIR, 'Skill dir');
  if (!existsSync(SKILL_JSON)) {
    throw new Error(`skill.json not found: ${SKILL_JSON}`);
  }

  const existingSkillId = process.env.ASK_SKILL_ID;
  if (existingSkillId) {
    console.log(`Using existing ASK_SKILL_ID: ${existingSkillId}`);
    persistSkillId(existingSkillId);
    return;
  }

  if (!process.env.ASK_VENDOR_ID) {
    throw new Error(`ASK_VENDOR_ID is required (set in ${ROOT_ENV}).`);
  }

  console.log('ASK_SKILL_ID is not set. Create a new skill now:');
  const manifestArg = `file:${SKILL_JSON}`;
  console.log(
    `ask smapi create-skill-for-vendor --manifest ${manifestArg} --full-response`
  );
  console.log('Then export the Skill ID and re-run step4:');
  console.log(`export ASK_SKILL_ID=amzn1.ask.skill.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`);
  console.log(`node ${ROOT}/scripts/deploy-all.mjs --step4`);
  process.exit(1);
}

function persistSkillId(skillId) {
  // Persist skillId in root .env (ASK_SKILL_ID)
  const envLines = [];
  if (existsSync(ROOT_ENV)) {
    envLines.push(...readFileSync(ROOT_ENV, 'utf8').split(/\r?\n/));
  }
  const filtered = envLines.filter((l) => !l.startsWith('ASK_SKILL_ID=') && l.trim() !== '');
  filtered.push(`ASK_SKILL_ID=${skillId}`);
  writeFileSync(ROOT_ENV, filtered.join('\n') + '\n');

  // Persist skillId in cdk/.env (ALEXA_SKILL_ID)
  const cdkLines = [];
  if (existsSync(CDK_ENV)) {
    cdkLines.push(...readFileSync(CDK_ENV, 'utf8').split(/\r?\n/));
  }
  const cdkFiltered = cdkLines.filter((l) => !l.startsWith('ALEXA_SKILL_ID=') && l.trim() !== '');
  cdkFiltered.push(`ALEXA_SKILL_ID=${skillId}`);
  writeFileSync(CDK_ENV, cdkFiltered.join('\n') + '\n');

  // Persist skillId in ask-resources.json
  if (existsSync(ASK_RESOURCES)) {
    const raw = readFileSync(ASK_RESOURCES, 'utf8');
    const json = JSON.parse(raw);
    json.profiles = json.profiles || {};
    json.profiles.default = json.profiles.default || {};
    json.profiles.default.skillId = skillId;
    writeFileSync(ASK_RESOURCES, JSON.stringify(json, null, 2) + '\n');
  }

  // Persist skillId in .ask/ask-states.json
  if (existsSync(ASK_STATES)) {
    const raw = readFileSync(ASK_STATES, 'utf8');
    const json = JSON.parse(raw);
    json.profiles = json.profiles || {};
    json.profiles.default = json.profiles.default || {};
    json.profiles.default.skillId = skillId;
    writeFileSync(ASK_STATES, JSON.stringify(json, null, 2) + '\n');
  }
}

function stepPatchSkill() {
  stepHeader('Patch skill.json');
  requireDir(SKILL_PKG_DIR, 'Skill package dir');
  if (!existsSync(SKILL_JSON)) {
    throw new Error(`skill.json not found: ${SKILL_JSON}`);
  }
  const arn = run('aws lambda get-function --function-name SldBltSmartHome --query "Configuration.FunctionArn" --output text');
  const raw = readFileSync(SKILL_JSON, 'utf8');
  const next = raw.split('${SMART_HOME_LAMBDA_ARN}').join(arn);
  writeFileSync(SKILL_JSON, next);
  console.log(`Patched skill.json with ARN: ${arn}`);
}

function stepAskDeploy() {
  stepHeader('ASK Deploy');
  requireDir(SKILL_DIR, 'Skill dir');
  // Smart Home skills don't use interaction models.
  const modelsDir = join(SKILL_PKG_DIR, 'models');
  if (existsSync(modelsDir)) {
    rmSync(modelsDir, { recursive: true, force: true });
    console.log(`Removed unused models dir: ${modelsDir}`);
  }
  const cmd = 'ask deploy -t skill-metadata';
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: SKILL_DIR });
}

function stepEnsurePermission() {
  stepHeader('Ensure Alexa Smart Home Lambda Permission');
  if (!process.env.ASK_SKILL_ID) {
    throw new Error(`ASK_SKILL_ID is required (set in ${ROOT_ENV}).`);
  }
  const statementId = `AlexaSmartHome-${process.env.ASK_SKILL_ID}`.replace(/[^a-zA-Z0-9-_]/g, '_');
  const cmd = [
    'aws lambda add-permission',
    '--function-name SldBltSmartHome',
    `--statement-id ${statementId}`,
    '--action lambda:InvokeFunction',
    '--principal alexa-connectedhome.amazon.com',
    `--event-source-token ${process.env.ASK_SKILL_ID}`,
  ].join(' ');
  console.log(`$ ${cmd}`);
  try {
    console.log(run(cmd));
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('ResourceConflictException') || msg.includes('StatementId')) {
      console.log('Permission already exists.');
      return;
    }
    throw err;
  }
}

function stepOauth() {
  stepHeader('OAuth (Login with Amazon)');
  console.log('Configure in Alexa Developer Console > Account Linking:');
  console.log('- Grant type: Authorization Code Grant');
  console.log('- Authorization URI: https://www.amazon.com/ap/oa');
  console.log('- Token URI: https://api.amazon.com/auth/o2/token');
  console.log('- Client ID / Secret: from your LWA Security Profile');
  console.log('- Scopes: profile, alexa::skills:account_linking');
}

function stepVerify() {
  stepHeader('Verify Lambda Policy');
  console.log('$ aws lambda get-policy --function-name SldBltSmartHome');
  try {
    console.log(run('aws lambda get-policy --function-name SldBltSmartHome'));
  } catch (err) {
    console.log('WARN: Failed to fetch Lambda policy. Retry when AWS endpoints are reachable.');
  }

  if (process.env.ASK_SKILL_ID) {
    stepHeader('Verify Skill Manifest');
    const cmd = `ask smapi get-skill-manifest --skill-id ${process.env.ASK_SKILL_ID}`;
    console.log(`$ ${cmd}`);
    try {
      console.log(run(cmd));
    } catch (err) {
      console.log('WARN: Failed to fetch skill manifest. Retry when ASK endpoints are reachable.');
    }
  } else {
    console.log('Skipping skill manifest check (ASK_SKILL_ID not set).');
  }
}

const arg = process.argv[2];
if (!arg) {
  usage();
  process.exit(1);
}

loadEnvFile();

try {
  switch (arg) {
    case '--check':
      stepCheck();
      break;
    case '--step1':
      stepBootstrap();
      break;
    case '--step2':
      stepDeploy();
      break;
    case '--step3':
      stepOutputs();
      break;
    case '--step4':
      stepCreateSkill();
      break;
    case '--step5':
      stepPatchSkill();
      break;
    case '--step6':
      stepEnsurePermission();
      break;
    case '--step7':
      stepAskDeploy();
      break;
    case '--step8':
      stepVerify();
      break;
    case '--step9':
      stepOauth();
      break;
    case '--all':
      stepCheck();
      stepBootstrap();
      stepDeploy();
      stepOutputs();
      stepCreateSkill();
      stepPatchSkill();
      stepEnsurePermission();
      stepAskDeploy();
      stepVerify();
      stepOauth();
      break;
    default:
      usage();
      process.exit(1);
  }
} catch (err) {
  console.error(String(err?.message || err));
  process.exit(1);
}

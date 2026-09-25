// validator-bot/run-all.ts
// Runs all 5 test validators concurrently in a single process.
// Each ValidatorBot gets its own keypair + API key so they are fully
// independent — they just share the same Node.js event loop and one
// Connection/websocket.
//
// Usage:
//   tsx run-all.ts
//
// Reads from .env — expects VALIDATOR_PRIVATE_KEY1..5 and VALIDATOR_API_KEY1..5

import dotenv from 'dotenv';
import { Connection } from '@solana/web3.js';
import { ValidatorBot, ValidatorConfig, botHeaders } from './val_bot.js';

dotenv.config({ path: '.env' });

// Delay between starting each validator, so all 5 don't slam the RPC
// endpoint with simultaneous getVersion/getProgramAccounts/websocket-subscribe
// calls at process startup.
const STARTUP_STAGGER_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Required shared env vars (needed by the bot itself, not per-validator)
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_SHARED_ENV: string[] = [
  'PLATFORM_API_URL',
  'NEXT_PUBLIC_SOLANA_RPC_URL',
];

function validateSharedEnv(): void {
  const missing = REQUIRED_SHARED_ENV.filter((k) => !process.env[k]?.trim());

  if (missing.length > 0) {
    console.error('\n❌ Missing required shared environment variables:');
    missing.forEach((k) => console.error(`   • ${k}`));
    console.error('\nAdd them to your .env file and restart.\n');
    process.exit(1);
  }

  // Validate PLATFORM_API_URL is a valid URL
  try {
    new URL(process.env.PLATFORM_API_URL!);
  } catch {
    console.error(`\n❌ PLATFORM_API_URL is not a valid URL: "${process.env.PLATFORM_API_URL}"`);
    console.error('   Example: http://localhost:3000\n');
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the list of validators from env
// ─────────────────────────────────────────────────────────────────────────────

function loadValidators(): ValidatorConfig[] {
  const configs: ValidatorConfig[] = [];
  const errors: string[] = [];

  for (let i = 1; i <= 5; i++) {
    const privateKey = process.env[`VALIDATOR_PRIVATE_KEY${i}`]?.trim();
    const apiKey     = process.env[`VALIDATOR_API_KEY${i}`]?.trim();

    const missingKeys: string[] = [];
    if (!privateKey) missingKeys.push(`VALIDATOR_PRIVATE_KEY${i}`);
    if (!apiKey)     missingKeys.push(`VALIDATOR_API_KEY${i}`);

    if (missingKeys.length > 0) {
      // Only warn — missing validators are skipped, not fatal
      console.warn(`⚠️  Skipping V${i} — missing: ${missingKeys.join(', ')}`);
      continue;
    }

    // Validate API key format (adjust prefix to match your platform's convention)
    if (!apiKey!.startsWith('vk_')) {
      errors.push(`VALIDATOR_API_KEY${i} looks invalid — expected format: vk_<hex> (got: ${apiKey!.slice(0, 12)}...)`);
      continue;
    }

    // Validate private key is non-empty base58 (basic sanity check)
    if (privateKey!.length < 32) {
      errors.push(`VALIDATOR_PRIVATE_KEY${i} looks too short — is it a valid base58 keypair?`);
      continue;
    }

    configs.push({
      privateKey: privateKey!,
      apiKey: apiKey!,
      label: `V${i}`,
    });
  }

  if (errors.length > 0) {
    console.error('\n❌ Env validation errors:');
    errors.forEach((e) => console.error(`   • ${e}`));
    console.error('');
    process.exit(1);
  }

  if (configs.length === 0) {
    console.error('\n❌ No validators configured.');
    console.error('   Set VALIDATOR_PRIVATE_KEY1..5 and VALIDATOR_API_KEY1..5 in your .env\n');
    process.exit(1);
  }

  return configs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-validator heartbeat
// ─────────────────────────────────────────────────────────────────────────────

function startHeartbeat(config: ValidatorConfig): void {
  const label = config.label ?? 'V?';

  const sendHeartbeat = async () => {
    try {
      const res = await fetch(`${process.env.PLATFORM_API_URL}/api/bot/heartbeat`, {
        method: 'POST',
        headers: botHeaders(config.apiKey),
      });
      if (!res.ok) {
        console.warn(`[${label}] ⚠️  Heartbeat rejected (${res.status})`);
      }
    } catch (err) {
      console.warn(`[${label}] ⚠️  Heartbeat failed: ${err}`);
    }
  };

  sendHeartbeat();                     // immediate on startup
  setInterval(sendHeartbeat, 60_000);  // every 60 seconds
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║           Multi-Validator Runner                  ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ── Env checks ──────────────────────────────────────────────────────────────
  console.log('🔍 Validating environment...');
  validateSharedEnv();

  const configs = loadValidators();

  console.log(`\n✅ Environment OK`);
  console.log(`   PLATFORM_API_URL : ${process.env.PLATFORM_API_URL}`);
  console.log(`   Validators loaded: ${configs.map((c) => c.label).join(', ')}\n`);

  // ── Shared Connection ─────────────────────────────────────────────────────
  // One Connection (and one websocket) shared by all 5 validators, instead
  // of each ValidatorBot opening its own — avoids 5x the RPC/websocket load
  // against a rate-limited endpoint.
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL!;
  const sharedConnection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint: rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://'),
  });

  // ── Start validators ─────────────────────────────────────────────────────
  console.log(`🚀 Starting ${configs.length} validators (staggered by ${STARTUP_STAGGER_MS}ms)...\n`);

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n👋 Shutting down all validators...');
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  // Start bots with a small stagger between each — Promise.allSettled so one
  // failure doesn't abort the others.
  const startPromises: Promise<void>[] = [];

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const bot = new ValidatorBot({ ...config, connection: sharedConnection });
    startHeartbeat(config); // fire immediately + every 60s, independent per validator
    startPromises.push(bot.start());

    if (i < configs.length - 1) {
      await sleep(STARTUP_STAGGER_MS);
    }
  }

  const results = await Promise.allSettled(startPromises);

  // Report any startup failures
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`❌ Validator ${configs[i]?.label ?? `V${i + 1}`} failed to start:`, result.reason);
    }
  });

  const started = results.filter((r) => r.status === 'fulfilled').length;
  console.log(`\n✅ ${started}/${configs.length} validators running. Press Ctrl+C to stop.\n`);

  if (started === 0) {
    console.error('❌ No validators started successfully. Exiting.');
    process.exit(1);
  }

  // Keep the process alive — the bots run via their websocket subscriptions
  // and setInterval timers, so the event loop stays active automatically.
}

main().catch((err) => {
  console.error('❌ Fatal error in run-all:', err);
  process.exit(1);
});
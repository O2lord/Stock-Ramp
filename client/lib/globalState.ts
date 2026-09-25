// client/lib/globalState.ts
// Server-side GlobalState account decoder, mirroring stockRampOrder.ts's
// pattern (own connection cache, hand-rolled Borsh-layout reader). Used by
// the admin register-validator / remove-validator API routes to
// independently re-verify the on-chain `authority` and validator roster
// rather than trusting the request body — same principle Trust Vault's
// equivalent routes use.
//
// Field layout mirrors programs/stock-ramp/src/state/global_state.rs
// exactly (see that file's #[account] struct for the source of truth).

import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import { SOLANA_RPC_ENDPOINT, GLOBAL_STATE_SEED, STOCK_RAMP_PROGRAM_ID } from "./constant";

export interface GlobalStateAccount {
  authority: PublicKey;
  validators: PublicKey[]; // fixed length 5, empty slots = Pubkey::default()
  validatorCount: number;
  requiredVotes: number;
  activeVoteCount: string;
}

const DEFAULT_PUBKEY = new PublicKey(new Uint8Array(32));

// Anchor account discriminators are sha256("account:<StructName>")[0..8].
// Computed at runtime rather than hardcoded so this stays correct even if
// the program is ever rebuilt.
function accountDiscriminator(structName: string): Buffer {
  return createHash("sha256").update(`account:${structName}`).digest().subarray(0, 8);
}

export function deserializeGlobalState(data: Buffer): GlobalStateAccount {
  const expected = accountDiscriminator("GlobalState");
  const actual = data.subarray(0, 8);
  if (!actual.equals(expected)) {
    throw new Error(`Invalid GlobalState discriminator: ${Array.from(actual)}`);
  }

  let offset = 8;
  const authority = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  offset += 8; // total_stock_ramp_created
  offset += 8; // total_stock_ramp_closed
  offset += 8; // total_confirmations
  offset += 2; // fee_percentage
  offset += 32; // fee_destination
  offset += 8; // total_fees_collected
  offset += 8; // total_disputes
  offset += 8; // total_volume
  offset += 8; // high_watermark_volume
  offset += 8; // last_volume_update
  offset += 1; // buy_orders_paused
  offset += 1; // sell_orders_paused

  const validators: PublicKey[] = [];
  for (let i = 0; i < 5; i++) {
    validators.push(new PublicKey(data.subarray(offset, offset + 32)));
    offset += 32;
  }

  const validatorCount = data.readUInt8(offset); offset += 1;
  const requiredVotes = data.readUInt8(offset); offset += 1;
  offset += 32; // validator_fee_pool_authority
  const activeVoteCount = data.readBigUInt64LE(offset); offset += 8;
  // bump: u8 follows, unused here.

  return {
    authority,
    validators,
    validatorCount,
    requiredVotes,
    activeVoteCount: activeVoteCount.toString(),
  };
}

let sharedConnection: Connection | null = null;
function getConnection(): Connection {
  if (!sharedConnection) {
    sharedConnection = new Connection(process.env.RPC_URL || SOLANA_RPC_ENDPOINT, "confirmed");
  }
  return sharedConnection;
}

export function findGlobalStatePda(programId = STOCK_RAMP_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], programId)[0];
}

export async function fetchGlobalState(): Promise<GlobalStateAccount> {
  const connection = getConnection();
  const pda = findGlobalStatePda();
  const info = await connection.getAccountInfo(pda);
  if (!info) throw new Error("GlobalState account not found — has initializeGlobalState() been called?");
  return deserializeGlobalState(info.data);
}

export function isValidatorInRoster(globalState: GlobalStateAccount, validator: PublicKey): boolean {
  return globalState.validators.some((v) => !v.equals(DEFAULT_PUBKEY) && v.equals(validator));
}

export { getConnection as getGlobalStateConnection };

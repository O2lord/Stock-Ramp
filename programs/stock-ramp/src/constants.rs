use anchor_lang::prelude::*;

// ---------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------
pub const ANCHOR_DISCRIMINATOR: usize = 8;

// ---------------------------------------------------------------------
// PDA seed prefixes
// ---------------------------------------------------------------------
pub const GLOBAL_STATE_SEED: &[u8] = b"global-state";
pub const STOCK_RAMP_ORDER_SEED: &[u8] = b"stock-ramp-order"; // was b"trust-express"
pub const VALIDATOR_VOTE_SEED: &[u8] = b"validator-vote";
pub const VALIDATOR_FEE_POOL_AUTHORITY_SEED: &[u8] = b"validator-fee-pool-authority";
pub const VALIDATOR_EARNINGS_SEED: &[u8] = b"validator-earnings";

// ---------------------------------------------------------------------
// Fee configuration
// ---------------------------------------------------------------------
pub const DEFAULT_FEE_BASIS_POINTS: u16 = 5; // 0.05%
pub const MAX_FEE_BASIS_POINTS: u16 = 1000; // 10%

// Fee split, applied in submit_buy_vote / submit_sell_vote's split_fee():
// 20% platform / 60% maker(LP) / 20% validator pool
pub const PLATFORM_FEE_SHARE_PCT: u64 = 20;
pub const MAKER_FEE_SHARE_PCT: u64 = 60;
// validator pool gets the true remainder (avoids integer-division dust loss)

// ---------------------------------------------------------------------
// Validator configuration
// ---------------------------------------------------------------------
pub const MAX_VALIDATORS: usize = 5;
pub const DEFAULT_REQUIRED_VOTES: u8 = 3;
pub const VOTE_EXPIRY_SECONDS: i64 = 30 * 60; // 30 minutes

// ---------------------------------------------------------------------
// Order / reservation limits
// ---------------------------------------------------------------------
pub const MAX_RESERVATIONS_PER_ORDER: usize = 10;
pub const MAX_PAYMENT_INSTRUCTIONS_LEN: usize = 100;
pub const MAX_CREDENTIAL_ID_LEN: usize = 64;

// ---------------------------------------------------------------------
// Reservation status codes
// ---------------------------------------------------------------------
pub const STATUS_PENDING: u8 = 0;
pub const STATUS_PAYMENT_SENT: u8 = 1;
pub const STATUS_COMPLETED: u8 = 2;
pub const STATUS_CANCELLED: u8 = 3;
pub const STATUS_DISPUTED: u8 = 4;

// ---------------------------------------------------------------------
// Payment mode
// ---------------------------------------------------------------------
pub const PAYMENT_MODE_LINK: u8 = 0;
pub const PAYMENT_MODE_DIRECT: u8 = 1;

/// Mirrors Trust Vault's compute_dust_threshold: 10^(decimals-3), floored at 1000.
pub fn compute_dust_threshold(decimals: u8) -> u64 {
    if decimals < 3 {
        return 1000;
    }
    10u64.saturating_pow((decimals - 3) as u32).max(1000)
}

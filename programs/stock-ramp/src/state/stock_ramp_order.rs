use anchor_lang::prelude::*;

use crate::state::reservation::ReservedAmount;

// was EXPRESS_SELL / EXPRESS_BUY
pub const STOCK_RAMP_SELL: u8 = 0;
pub const STOCK_RAMP_BUY: u8 = 1;

/// The on-chain escrow account. One per LP order. (was TrustExpress)
/// Seeds: [b"stock-ramp-order", maker.key(), seed.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct StockRampOrder {
    pub seed: u64,
    pub maker: Pubkey,
    pub mint: Pubkey, // xStocks mint (Token-2022 or classic SPL)
    #[max_len(3)]
    pub currency: [u8; 3], // e.g. b"NGN" — exactly 3 bytes
    pub escrow_type: u8, // 0 = STOCK_RAMP_SELL, 1 = STOCK_RAMP_BUY
    pub fee_percentage: u16, // snapshot of global fee at creation
    pub fee_destination: Pubkey,
    pub reserved_fee: u64,
    pub amount: u64, // AVAILABLE tokens only (not total deposited)
    pub price_per_token: u64, // fiat per whole token (raw fiat units)
    #[max_len(100)]
    pub payment_instructions: String, // LP bank info
    #[max_len(10)]
    pub reserved_amounts: Vec<ReservedAmount>, // max 10
    #[max_len(64)]
    pub flutterwave_credential_id: Option<String>,
    pub bump: u8,
}

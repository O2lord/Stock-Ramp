use anchor_lang::prelude::*;

#[event]
pub struct BuyOrderCreatedEvent {
    pub stock_ramp_order: Pubkey,
    pub buyer: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub price_per_token: u64,
    pub currency: String,
    pub payment_instructions: String,
    pub flutterwave_credential_id: Option<String>,
}

#[event]
pub struct BuyOrderCancelledEvent {
    pub stock_ramp_order: Pubkey,
    pub buyer: Pubkey,
    pub original_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct BuyOrderReducedEvent {
    pub stock_ramp_order: Pubkey,
    pub buyer: Pubkey,
    pub original_amount: u64,
    pub new_amount: u64,
    pub timestamp: i64,
}

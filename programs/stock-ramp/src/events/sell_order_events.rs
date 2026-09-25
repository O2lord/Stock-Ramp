use anchor_lang::prelude::*;

#[event]
pub struct SellOrderCreatedEvent {
    pub stock_ramp_order: Pubkey,
    pub seller: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub price_per_token: u64,
    pub currency: String,
    pub payment_instructions: String,
    pub flutterwave_credential_id: Option<String>,
}

#[event]
pub struct InstantSellReservationCreatedEvent {
    pub stock_ramp_order: Pubkey,
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub amount: u64,
    pub fiat_amount: u64,
    pub currency: String,
    pub payment_mode: u8,
    pub payout_reference: String,
}

#[event]
pub struct InstantSellPaymentResultEvent {
    pub stock_ramp_order: Pubkey,
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub amount: u64,
    pub fiat_amount: u64,
    pub currency: String,
    pub payout_reference: String,
    pub success: bool,
    pub message: String,
    pub fee_amount: u64,
}

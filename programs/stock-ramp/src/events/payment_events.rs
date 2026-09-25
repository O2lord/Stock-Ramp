use anchor_lang::prelude::*;

/// Emitted by instant_reserve when a taker locks tokens into a buy-order escrow.
#[event]
pub struct InstantPaymentReservedEvent {
    pub stock_ramp_order: Pubkey,
    pub taker: Pubkey,
    pub amount: u64,
    pub fiat_amount: u64,
    pub currency: String,
    pub payout_details: Option<String>,
    pub payout_reference: String,
}

#[event]
pub struct InstantPaymentPayoutQueuedEvent {
    pub stock_ramp_order: Pubkey,
    pub taker: Pubkey,
    pub amount: u64,
    pub fiat_amount: u64,
    pub currency: String,
    pub payout_reference: String,
}

#[event]
pub struct InstantPaymentPayoutResultEvent {
    pub stock_ramp_order: Pubkey,
    pub taker: Pubkey,
    pub amount: u64,
    pub fiat_amount: u64,
    pub currency: String,
    pub payout_reference: String,
    pub success: bool,
    pub message: String,
}

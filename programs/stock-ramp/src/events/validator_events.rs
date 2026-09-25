use anchor_lang::prelude::*;

#[event]
pub struct ValidatorRegisteredEvent {
    pub authority: Pubkey,
    pub validator: Pubkey,
    pub slot: u8,
    pub timestamp: i64,
}

#[event]
pub struct ValidatorRemovedEvent {
    pub authority: Pubkey,
    pub validator: Pubkey,
    pub slot: u8,
    pub timestamp: i64,
}

#[event]
pub struct ValidatorVoteCastEvent {
    pub stock_ramp_order: Pubkey,
    pub validator: Pubkey,
    pub payout_reference: String,
    pub vote: bool,
    pub votes_for: u8,
    pub votes_against: u8,
    pub timestamp: i64,
}

#[event]
pub struct ValidatorVoteExecutedEvent {
    pub stock_ramp_order: Pubkey,
    pub taker: Pubkey,
    pub payout_reference: String,
    pub success: bool,
    pub message: String,
    pub amount: u64,
    pub fiat_amount: u64,
    pub currency: String,
    pub timestamp: i64,
}

#[event]
pub struct ValidatorFeeClaimedEvent {
    pub validator: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

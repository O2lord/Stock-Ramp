use anchor_lang::prelude::*;

#[event]
pub struct FeePercentageUpdatedEvent {
    pub authority: Pubkey,
    pub old_fee: u16,
    pub new_fee: u16,
    pub timestamp: i64,
}

#[event]
pub struct FeeDestinationUpdatedEvent {
    pub authority: Pubkey,
    pub old_destination: Pubkey,
    pub new_destination: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct BuyOrdersPausedEvent {
    pub authority: Pubkey,
    pub paused: bool,
    pub timestamp: i64,
}

#[event]
pub struct SellOrdersPausedEvent {
    pub authority: Pubkey,
    pub paused: bool,
    pub timestamp: i64,
}

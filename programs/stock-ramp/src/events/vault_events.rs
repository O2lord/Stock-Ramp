use anchor_lang::prelude::*;

#[event]
pub struct OrderNearlyEmptyEvent {
    pub stock_ramp_order: Pubkey,
    pub maker: Pubkey,
    pub remaining_amount: u64,
    pub active_reservations: u32,
    pub timestamp: i64,
}

#[event]
pub struct OrderCloseFailedEvent {
    pub stock_ramp_order: Pubkey,
    pub maker: Pubkey,
    pub remaining_amount: u64,
    pub error_code: u32,
    pub timestamp: i64,
    pub reason: String,
}

#[event]
pub struct OrderClosedEvent {
    pub stock_ramp_order: Pubkey,
    pub maker: Pubkey,
    pub remaining_amount: u64,
}

#[event]
pub struct PartialWithdrawalEvent {
    pub stock_ramp_order: Pubkey,
    pub maker: Pubkey,
    pub withdrawal_amount: u64,
    pub remaining_amount: u64,
}

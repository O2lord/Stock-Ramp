use anchor_lang::prelude::*;

#[event]
pub struct PriceUpdatedEvent {
    pub stock_ramp_order: Pubkey,
    pub maker: Pubkey,
    pub old_price: u64,
    pub new_price: u64,
    pub currency: String,
}

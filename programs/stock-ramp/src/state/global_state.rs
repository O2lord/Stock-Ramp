use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct GlobalState {
    pub authority: Pubkey,
    pub total_stock_ramp_created: u64, // was total_trust_express_created
    pub total_stock_ramp_closed: u64,  // was total_trust_express_closed
    pub total_confirmations: u64,
    pub fee_percentage: u16, // basis points, default 5
    pub fee_destination: Pubkey,
    pub total_fees_collected: u64,
    pub total_disputes: u64,
    pub total_volume: u64,
    pub high_watermark_volume: u64,
    pub last_volume_update: i64,
    pub buy_orders_paused: bool,
    pub sell_orders_paused: bool,
    pub validators: [Pubkey; 5], // empty slots = Pubkey::default()
    pub validator_count: u8,
    pub required_votes: u8, // default 3
    pub validator_fee_pool_authority: Pubkey,
    pub active_vote_count: u64, // open ValidatorVote PDAs not yet executed/expired
    pub bump: u8,
}

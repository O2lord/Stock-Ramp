use anchor_lang::prelude::*;

/// Seeds: [b"validator-vote", stock_ramp_order.key(), reference_hash]
#[account]
#[derive(InitSpace)]
pub struct ValidatorVote {
    pub stock_ramp_order: Pubkey, // was trust_express
    pub taker: Pubkey,
    pub reference_hash: [u8; 32],
    pub votes_for: u8,
    pub votes_against: u8,
    pub voters: [Pubkey; 5],
    pub vote_results: [bool; 5],
    pub executed: bool,
    pub created_at: i64,
    pub expires_at: i64,
    pub is_buy_order: bool,
    pub bump: u8,
}

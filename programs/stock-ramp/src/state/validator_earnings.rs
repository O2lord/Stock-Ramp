use anchor_lang::prelude::*;

/// Seeds: [b"validator-earnings", validator_pubkey, mint_pubkey]
#[account]
#[derive(InitSpace)]
pub struct ValidatorEarnings {
    pub validator: Pubkey,
    pub mint: Pubkey,
    pub accumulated_amount: u64, // claimable now — zeroed after claim
    pub total_earned: u64,       // lifetime (never decrements)
    pub total_credits: u64,      // vote executions credited
    pub last_credited_at: i64,
    pub bump: u8,
}

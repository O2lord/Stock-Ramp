use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::state::GlobalState;

/// One-time (per mint) setup instruction. Creates the validator fee pool's
/// associated token account if it doesn't already exist.
///
/// This is intentionally its own instruction — separate from
/// SubmitBuyVote / SubmitSellVote — because `init_if_needed` on an
/// associated token account inlines a large CPI account-creation block
/// into the generated `try_accounts` function. Keeping it here, in a
/// struct with very few accounts and only ONE init constraint, keeps
/// this function's stack frame small. Bundling it into the vote
/// instructions (which already carry ~14 accounts and another
/// `init_if_needed` for `validator_vote`) is what pushed those
/// instructions' `try_accounts` past the 4096-byte SBF stack limit.
///
/// Call this once per mint (e.g. the first time a validator is about to
/// vote on an order for that mint) before calling submit_buy_vote /
/// submit_sell_vote. If the ATA already exists this is a cheap no-op.
#[derive(Accounts)]
pub struct InitializeValidatorFeePoolAta<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [b"global-state"], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: dedicated pool authority PDA — same seeds used in submit_vote.rs
    #[account(seeds = [b"validator-fee-pool-authority"], bump)]
    pub validator_fee_pool_authority: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = validator_fee_pool_authority,
        associated_token::token_program = token_program,
    )]
    pub validator_fee_pool_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_validator_fee_pool_ata(
    _ctx: Context<InitializeValidatorFeePoolAta>,
) -> Result<()> {
    // Anchor's `init_if_needed` constraint has already done the work —
    // nothing further to do here.
    Ok(())
}

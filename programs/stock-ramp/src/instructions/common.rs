use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::StockRampError;
use crate::state::GlobalState;

/// Transfers `amount` of `mint` from `from` to `to`, signed by `authority`
/// (a wallet signer, not a PDA — see submit_vote.rs for PDA-signed transfers).
pub fn transfer_tokens<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    amount: &u64,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &Signer<'info>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<()> {
    transfer_checked(
        CpiContext::new(
            token_program.to_account_info(),
            TransferChecked {
                from: from.to_account_info(),
                to: to.to_account_info(),
                authority: authority.to_account_info(),
                mint: mint.to_account_info(),
            },
        ),
        *amount,
        mint.decimals,
    )
}

/// Tracks the highest total_volume ever seen, for stats/reporting.
/// Called after any operation that changes total_volume.
pub fn ensure_high_watermark_preserved(global_state: &mut GlobalState) -> Result<()> {
    let clock = Clock::get()?;
    if global_state.total_volume > global_state.high_watermark_volume {
        global_state.high_watermark_volume = global_state.total_volume;
        global_state.last_volume_update = clock.unix_timestamp;
    }
    Ok(())
}

pub fn assert_registered_validator(gs: &GlobalState, validator: &Pubkey) -> Result<()> {
    require!(
        gs.validators.contains(validator),
        StockRampError::UnauthorizedValidator
    );
    Ok(())
}

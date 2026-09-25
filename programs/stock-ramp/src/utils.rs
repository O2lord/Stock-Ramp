use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{DEFAULT_FEE_BASIS_POINTS, DEFAULT_REQUIRED_VOTES, MAX_CREDENTIAL_ID_LEN, MAX_PAYMENT_INSTRUCTIONS_LEN};
use crate::error::StockRampError;
use crate::state::GlobalState;

/// Parses a currency string into the fixed [u8; 3] representation
/// stored on-chain (e.g. "NGN" -> [78, 71, 78]).
pub fn parse_currency(currency: &str) -> Result<[u8; 3]> {
    let bytes = currency.as_bytes();
    require!(bytes.len() == 3, StockRampError::InvalidCurrency);
    Ok([bytes[0], bytes[1], bytes[2]])
}

/// Shared validation for buy/sell order creation fields.
pub fn validate_order_fields(
    amount: u64,
    price_per_token: u64,
    payment_instructions: &str,
    credential_id: &str,
) -> Result<()> {
    require!(amount > 0, StockRampError::InvalidAmount);
    require!(price_per_token > 0, StockRampError::InvalidPrice);
    require!(
        payment_instructions.len() <= MAX_PAYMENT_INSTRUCTIONS_LEN,
        StockRampError::PaymentInstructionsTooLong
    );
    require!(
        !credential_id.is_empty() && credential_id.len() <= MAX_CREDENTIAL_ID_LEN,
        StockRampError::InvalidCredentialId
    );
    Ok(())
}

/// Idempotent global-state bootstrap — only writes defaults the first time
/// (checks total_stock_ramp_created/closed/total_confirmations are all 0).
pub fn initialize_global_state_if_needed(
    global_state: &mut Account<GlobalState>,
    _mint: &InterfaceAccount<Mint>,
    bump: u8,
) {
    let is_uninitialized = global_state.total_stock_ramp_created == 0
        && global_state.total_stock_ramp_closed == 0
        && global_state.total_confirmations == 0
        && global_state.authority == Pubkey::default();

    if is_uninitialized {
        global_state.fee_percentage = DEFAULT_FEE_BASIS_POINTS;
        global_state.required_votes = DEFAULT_REQUIRED_VOTES;
        global_state.validators = [Pubkey::default(); 5];
        global_state.validator_count = 0;
        global_state.bump = bump;
        // NOTE: authority/fee_destination should already be set by an explicit
        // initialize_global_state call in normal flow — this init_if_needed
        // path only covers the case where a buy/sell order is the very first
        // instruction ever called against a fresh deployment.
    }
}

/// Reads the owner of a token account, supporting both classic SPL Token
/// and Token-2022 (needed since xStocks mints may use either program).
pub fn get_token_account_owner<'info>(
    token_account: &AccountInfo<'info>,
    _token_program: &Interface<'info, TokenInterface>,
) -> Result<Pubkey> {
    let data = token_account.try_borrow_data()?;
    require!(data.len() >= 64, StockRampError::InvalidMint);
    // SPL Token / Token-2022 account layout: mint(32) + owner(32) + ...
    let owner_bytes = &data[32..64];
    Ok(Pubkey::try_from(owner_bytes).map_err(|_| StockRampError::InvalidMint)?)
}

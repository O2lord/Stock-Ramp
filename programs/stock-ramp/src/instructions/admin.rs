use anchor_lang::prelude::*;

use crate::constants::{
    ANCHOR_DISCRIMINATOR, DEFAULT_FEE_BASIS_POINTS, DEFAULT_REQUIRED_VOTES, MAX_FEE_BASIS_POINTS,
};
use crate::error::StockRampError;
use crate::events::{
    BuyOrdersPausedEvent, FeeDestinationUpdatedEvent, FeePercentageUpdatedEvent,
    SellOrdersPausedEvent, ValidatorRegisteredEvent, ValidatorRemovedEvent,
};
use crate::state::GlobalState;

#[derive(Accounts)]
pub struct InitializeGlobalState<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = ANCHOR_DISCRIMINATOR + GlobalState::INIT_SPACE,
        seeds = [b"global-state"],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_global_state(ctx: Context<InitializeGlobalState>) -> Result<()> {
    let gs = &mut ctx.accounts.global_state;

    // Idempotent — only set defaults the first time.
    if gs.authority != Pubkey::default() {
        return Ok(());
    }

    gs.authority = ctx.accounts.authority.key();
    gs.total_stock_ramp_created = 0;
    gs.total_stock_ramp_closed = 0;
    gs.total_confirmations = 0;
    gs.fee_percentage = DEFAULT_FEE_BASIS_POINTS;
    gs.fee_destination = ctx.accounts.authority.key();
    gs.total_fees_collected = 0;
    gs.total_disputes = 0;
    gs.total_volume = 0;
    gs.high_watermark_volume = 0;
    gs.last_volume_update = Clock::get()?.unix_timestamp;
    gs.buy_orders_paused = false;
    gs.sell_orders_paused = false;
    gs.validators = [Pubkey::default(); 5];
    gs.validator_count = 0;
    gs.required_votes = DEFAULT_REQUIRED_VOTES;
    // NOTE: validator_fee_pool_authority is a PDA derived from a fixed seed
    // (b"validator-fee-pool-authority"), not stored input — set it explicitly
    // here so submit_buy_vote/submit_sell_vote's require_keys_eq! check passes.
    let (pool_authority, _bump) =
        Pubkey::find_program_address(&[b"validator-fee-pool-authority"], &crate::ID);
    gs.validator_fee_pool_authority = pool_authority;
    gs.active_vote_count = 0;
    gs.bump = ctx.bumps.global_state;

    Ok(())
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"global-state"],
        bump = global_state.bump,
        has_one = authority @ StockRampError::Unauthorized
    )]
    pub global_state: Account<'info, GlobalState>,
}

pub fn update_fee_percentage(ctx: Context<AdminAction>, new_fee: u16) -> Result<()> {
    require!(
        new_fee <= MAX_FEE_BASIS_POINTS,
        StockRampError::InvalidFeePercentage
    );
    let gs = &mut ctx.accounts.global_state;
    let old_fee = gs.fee_percentage;
    gs.fee_percentage = new_fee;

    emit!(FeePercentageUpdatedEvent {
        authority: ctx.accounts.authority.key(),
        old_fee,
        new_fee,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn update_fee_destination(ctx: Context<AdminAction>, new_destination: Pubkey) -> Result<()> {
    let gs = &mut ctx.accounts.global_state;
    let old_destination = gs.fee_destination;
    gs.fee_destination = new_destination;

    emit!(FeeDestinationUpdatedEvent {
        authority: ctx.accounts.authority.key(),
        old_destination,
        new_destination,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn pause_buy_orders(ctx: Context<AdminAction>, paused: bool) -> Result<()> {
    ctx.accounts.global_state.buy_orders_paused = paused;
    emit!(BuyOrdersPausedEvent {
        authority: ctx.accounts.authority.key(),
        paused,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn pause_sell_orders(ctx: Context<AdminAction>, paused: bool) -> Result<()> {
    ctx.accounts.global_state.sell_orders_paused = paused;
    emit!(SellOrdersPausedEvent {
        authority: ctx.accounts.authority.key(),
        paused,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn register_validator(ctx: Context<AdminAction>, validator: Pubkey) -> Result<()> {
    let gs = &mut ctx.accounts.global_state;

    // FIX: check for an existing duplicate BEFORE checking slot capacity.
    // A duplicate registration doesn't consume a new slot, so once all 5
    // slots are full, re-registering an already-present validator should
    // still surface ValidatorAlreadyRegistered — not ValidatorSlotsFull,
    // which should be reserved for genuinely new validators with nowhere
    // to go.
    require!(
        !gs.validators.contains(&validator),
        StockRampError::ValidatorAlreadyRegistered
    );
    require!(
        (gs.validator_count as usize) < 5,
        StockRampError::ValidatorSlotsFull
    );

    let mut slot_index = 0u8;
    for (i, slot) in gs.validators.iter_mut().enumerate() {
        if *slot == Pubkey::default() {
            *slot = validator;
            slot_index = i as u8;
            break;
        }
    }
    gs.validator_count = gs.validator_count.saturating_add(1);

    emit!(ValidatorRegisteredEvent {
        authority: ctx.accounts.authority.key(),
        validator,
        slot: slot_index,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn remove_validator(ctx: Context<AdminAction>, validator: Pubkey) -> Result<()> {
    let gs = &mut ctx.accounts.global_state;
    require!(
        gs.active_vote_count == 0,
        StockRampError::ActiveVotesInProgress
    );

    let mut found_slot: Option<u8> = None;
    for (i, slot) in gs.validators.iter_mut().enumerate() {
        if *slot == validator {
            *slot = Pubkey::default();
            found_slot = Some(i as u8);
            break;
        }
    }
    let slot = found_slot.ok_or(StockRampError::ValidatorNotFound)?;
    gs.validator_count = gs.validator_count.saturating_sub(1);

    emit!(ValidatorRemovedEvent {
        authority: ctx.accounts.authority.key(),
        validator,
        slot,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn update_required_votes(ctx: Context<AdminAction>, n: u8) -> Result<()> {
    let gs = &mut ctx.accounts.global_state;
    require!(n >= 1 && n <= 5, StockRampError::InvalidVoteThreshold);
    require!(
        n <= gs.validator_count,
        StockRampError::ThresholdExceedsValidators
    );
    gs.required_votes = n;
    Ok(())
}

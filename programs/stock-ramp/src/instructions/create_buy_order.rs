use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenInterface},
};

use crate::constants::ANCHOR_DISCRIMINATOR;
use crate::error::StockRampError;
use crate::events::BuyOrderCreatedEvent;
use crate::instructions::common::ensure_high_watermark_preserved;
use crate::state::{GlobalState, StockRampOrder, STOCK_RAMP_BUY};
use crate::utils::{initialize_global_state_if_needed, parse_currency, validate_order_fields};

#[derive(Accounts)]
#[instruction(
    seed: u64,
    amount: u64,
    price_per_token: u64,
    currency: String,
    payment_instructions: String,
    flutterwave_credential_id: String,
)]
pub struct CreateBuyOrder<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = buyer,
        space = ANCHOR_DISCRIMINATOR + StockRampOrder::INIT_SPACE,
        seeds = [b"stock-ramp-order", buyer.key().as_ref(), seed.to_le_bytes().as_ref()],
        bump
    )]
    pub stock_ramp_order: Box<Account<'info, StockRampOrder>>,

    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + GlobalState::INIT_SPACE,
        seeds = [b"global-state"],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn create_buy_order(
    context: Context<CreateBuyOrder>,
    seed: u64,
    amount: u64,
    price_per_token: u64,
    currency: String,
    payment_instructions: String,
    flutterwave_credential_id: String,
) -> Result<()> {
    require!(
        !context.accounts.global_state.buy_orders_paused,
        StockRampError::BuyOrdersPaused
    );

    validate_order_fields(
        amount,
        price_per_token,
        &payment_instructions,
        &flutterwave_credential_id,
    )?;

    let currency_bytes = parse_currency(&currency)?;

    initialize_global_state_if_needed(
        &mut context.accounts.global_state,
        &context.accounts.mint,
        context.bumps.global_state,
    );

    let fee_percentage = context.accounts.global_state.fee_percentage;
    let fee_destination = context.accounts.global_state.authority;

    context.accounts.stock_ramp_order.set_inner(StockRampOrder {
        seed,
        escrow_type: STOCK_RAMP_BUY,
        maker: context.accounts.buyer.key(),
        mint: context.accounts.mint.key(),
        amount,
        reserved_fee: 0,
        price_per_token,
        currency: currency_bytes,
        fee_percentage,
        fee_destination,
        payment_instructions: payment_instructions.clone(),
        reserved_amounts: Vec::new(),
        flutterwave_credential_id: Some(flutterwave_credential_id.clone()),
        bump: context.bumps.stock_ramp_order,
    });

    let global_state = &mut context.accounts.global_state;
    global_state.total_stock_ramp_created += 1;

    ensure_high_watermark_preserved(global_state)?;

    emit!(BuyOrderCreatedEvent {
        stock_ramp_order: context.accounts.stock_ramp_order.key(),
        buyer: context.accounts.buyer.key(),
        mint: context.accounts.mint.key(),
        amount,
        price_per_token,
        currency: String::from_utf8_lossy(&currency_bytes).to_string(),
        payment_instructions,
        flutterwave_credential_id: Some(flutterwave_credential_id.clone()),
    });

    msg!(
        "Buy order created for {} tokens at {} per token",
        amount,
        price_per_token
    );

    Ok(())
}

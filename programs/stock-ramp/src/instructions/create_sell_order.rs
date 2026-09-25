use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::constants::ANCHOR_DISCRIMINATOR;
use crate::error::StockRampError;
use crate::events::SellOrderCreatedEvent;
use crate::instructions::common::{ensure_high_watermark_preserved, transfer_tokens};
use crate::state::{GlobalState, StockRampOrder, STOCK_RAMP_SELL};
use crate::utils::{parse_currency, validate_order_fields};

#[derive(Accounts)]
#[instruction(
    seed: u64,
    amount: u64,
    price_per_token: u64,
    currency: String,
    payment_instructions: String,
    flutterwave_credential_id: String,
)]
pub struct CreateSellOrder<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = seller,
        associated_token::token_program = token_program
    )]
    pub seller_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = seller,
        space = ANCHOR_DISCRIMINATOR + StockRampOrder::INIT_SPACE,
        seeds = [b"stock-ramp-order", seller.key().as_ref(), seed.to_le_bytes().as_ref()],
        bump
    )]
    pub stock_ramp_order: Box<Account<'info, StockRampOrder>>,

    #[account(
        init,
        payer = seller,
        associated_token::mint = mint,
        associated_token::authority = stock_ramp_order,
        associated_token::token_program = token_program
    )]
    pub stock_ramp_order_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    // Global singleton — created once via a dedicated `initialize_global_state`
    // instruction, not lazily here. `init_if_needed` on a shared/global account
    // inlines a full account-creation CPI block into this instruction's
    // generated `try_accounts`, which — combined with the two `init` accounts
    // above — was pushing this function's SBF stack frame past the 4096-byte
    // limit ("Stack offset ... exceeded max offset of 4096"). Matches the
    // pattern already used for `global_state` in submit_vote.rs.
    #[account(mut, seeds = [b"global-state"], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

fn send_tokens_to_escrow(ctx: &Context<CreateSellOrder>, amount: u64) -> Result<()> {
    transfer_tokens(
        &ctx.accounts.seller_ata,
        &ctx.accounts.stock_ramp_order_ata,
        &amount,
        &ctx.accounts.mint,
        &ctx.accounts.seller,
        &ctx.accounts.token_program,
    )
}

pub fn create_sell_order(
    context: Context<CreateSellOrder>,
    seed: u64,
    amount: u64,
    price_per_token: u64,
    currency: String,
    payment_instructions: String,
    flutterwave_credential_id: String,
) -> Result<()> {
    require!(
        !context.accounts.global_state.sell_orders_paused,
        StockRampError::SellOrdersPaused
    );

    validate_order_fields(
        amount,
        price_per_token,
        &payment_instructions,
        &flutterwave_credential_id,
    )?;

    let currency_bytes = parse_currency(&currency)?;

    send_tokens_to_escrow(&context, amount)?;

    let fee_percentage = context.accounts.global_state.fee_percentage;

    // Full deposit is available — fee is charged on settlement, not at creation
    let available_amount = amount;

    let fee_destination = context.accounts.global_state.authority;

    context.accounts.stock_ramp_order.set_inner(StockRampOrder {
        seed,
        escrow_type: STOCK_RAMP_SELL,
        maker: context.accounts.seller.key(),
        mint: context.accounts.mint.key(),
        amount: available_amount,
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

    emit!(SellOrderCreatedEvent {
        stock_ramp_order: context.accounts.stock_ramp_order.key(),
        seller: context.accounts.seller.key(),
        mint: context.accounts.mint.key(),
        amount: available_amount,
        price_per_token,
        currency: String::from_utf8_lossy(&currency_bytes).to_string(),
        payment_instructions,
        flutterwave_credential_id: Some(flutterwave_credential_id.clone()),
    });

    msg!(
        "Sell order created: seller deposited {} tokens, all {} available for sale, fee charged on settlement",
        amount,
        available_amount
    );

    Ok(())
}

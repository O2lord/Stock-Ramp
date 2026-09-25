use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::error::StockRampError;
use crate::events::InstantPaymentReservedEvent;
use crate::state::{GlobalState, ReservedAmount, StockRampOrder};

#[derive(Accounts)]
pub struct InstantReserve<'info> {
    #[account(mut, has_one = maker)]
    pub stock_ramp_order: Box<Account<'info, StockRampOrder>>,

    /// CHECK: validated by has_one = maker
    pub maker: AccountInfo<'info>,

    #[account(mut)]
    pub taker: Signer<'info>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint,
        associated_token::authority = taker,
        associated_token::token_program = token_program
    )]
    pub taker_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint,
        associated_token::authority = stock_ramp_order,
        associated_token::token_program = token_program
    )]
    pub stock_ramp_order_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [b"global-state"],
        bump = global_state.bump,
    )]
    pub global_state: Box<Account<'info, GlobalState>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InstantReserve>,
    amount: u64,
    fiat_amount: u64,
    currency: String,
    payout_details: Option<String>,
) -> Result<()> {
    require!(
        !ctx.accounts.global_state.buy_orders_paused,
        StockRampError::BuyOrdersPaused
    );

    require!(amount > 0, StockRampError::InvalidAmount);
    let stock_ramp_order = &mut ctx.accounts.stock_ramp_order;
    let mint = &ctx.accounts.mint;

    let clock = Clock::get()?;
    // "SR-" prefix (was "IP-") — update client/bot payout_reference parsing to match
    let payout_reference = format!(
        "SR-{}-{}",
        clock.unix_timestamp,
        &ctx.accounts.taker.key().to_string()[..8]
    );

    require!(
        stock_ramp_order.reserved_amounts.len() < 10,
        StockRampError::ReservationLimitReached
    );

    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.taker_ata.to_account_info(),
            to: ctx.accounts.stock_ramp_order_ata.to_account_info(),
            authority: ctx.accounts.taker.to_account_info(),
            mint: mint.to_account_info(),
        },
    );

    transfer_checked(transfer_ctx, amount, mint.decimals)?;

    let reservation = ReservedAmount {
        taker: ctx.accounts.taker.key(),
        amount,
        fiat_amount,
        timestamp: clock.unix_timestamp,
        seller_instructions: None,
        status: 0,
        dispute_reason: None,
        dispute_id: None,
        payout_details: payout_details.clone(),
        payout_reference: Some(payout_reference.clone()),
        payment_link: None,
        payment_mode: 0,
        transaction_reference: None,
    };

    stock_ramp_order.reserved_amounts.push(reservation);

    stock_ramp_order.amount = stock_ramp_order
        .amount
        .checked_sub(amount)
        .ok_or(StockRampError::ArithmeticOverflow)?;

    emit!(InstantPaymentReservedEvent {
        stock_ramp_order: stock_ramp_order.key(),
        taker: ctx.accounts.taker.key(),
        amount,
        fiat_amount,
        currency,
        payout_details,
        payout_reference,
    });

    Ok(())
}
use anchor_lang::prelude::*;

use crate::error::StockRampError;
use crate::events::InstantSellReservationCreatedEvent;
use crate::state::{GlobalState, ReservedAmount, StockRampOrder, STOCK_RAMP_SELL};

#[derive(Accounts)]
pub struct InstantSellReserve<'info> {
    #[account(mut, has_one = maker)]
    pub stock_ramp_order: Account<'info, StockRampOrder>,

    /// CHECK: validated by has_one = maker (the seller)
    pub maker: AccountInfo<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        seeds = [b"global-state"],
        bump = global_state.bump,
    )]
    pub global_state: Account<'info, GlobalState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InstantSellReserve>,
    amount: u64,
    payment_mode: u8,
    buyer_payout_details: Option<String>,
    payout_reference: String,
) -> Result<()> {
    require!(
        !ctx.accounts.global_state.sell_orders_paused,
        StockRampError::SellOrdersPaused
    );

    require!(amount > 0, StockRampError::InvalidAmount);
    require!(
        payment_mode == 0 || payment_mode == 1,
        StockRampError::InvalidPaymentMode
    );
    require!(
        !payout_reference.is_empty(),
        StockRampError::InvalidPayoutReference
    );

    let stock_ramp_order = &mut ctx.accounts.stock_ramp_order;

    require!(
        stock_ramp_order.escrow_type == STOCK_RAMP_SELL,
        StockRampError::InvalidEscrowType
    );

    require!(
        stock_ramp_order.amount >= amount,
        StockRampError::InsufficientAmount
    );

    require!(
        stock_ramp_order.reserved_amounts.len() < 10,
        StockRampError::ReservationLimitReached
    );

    let clock = Clock::get()?;

    let fiat_amount = amount
        .checked_mul(stock_ramp_order.price_per_token)
        .ok_or(StockRampError::ArithmeticOverflow)?;

    let reservation = ReservedAmount {
        taker: ctx.accounts.buyer.key(),
        amount,
        fiat_amount,
        timestamp: clock.unix_timestamp,
        seller_instructions: None,
        status: 0, // Pending payment
        dispute_reason: None,
        dispute_id: None,
        payout_details: buyer_payout_details.clone(),
        payout_reference: Some(payout_reference.clone()),
        payment_mode,
        payment_link: None,
        transaction_reference: None,
    };

    stock_ramp_order.reserved_amounts.push(reservation);

    stock_ramp_order.amount = stock_ramp_order
        .amount
        .checked_sub(amount)
        .ok_or(StockRampError::ArithmeticOverflow)?;

    emit!(InstantSellReservationCreatedEvent {
        stock_ramp_order: stock_ramp_order.key(),
        maker: stock_ramp_order.maker,
        taker: ctx.accounts.buyer.key(),
        amount,
        fiat_amount,
        currency: String::from_utf8_lossy(&stock_ramp_order.currency).to_string(),
        payment_mode,
        payout_reference: payout_reference.clone(),
    });

    msg!(
        "Reservation created for buyer {} to purchase {} tokens for {} fiat (mode: {}, ref: {})",
        ctx.accounts.buyer.key(),
        amount,
        fiat_amount,
        if payment_mode == 0 { "payment link" } else { "direct transfer" },
        payout_reference
    );

    Ok(())
}

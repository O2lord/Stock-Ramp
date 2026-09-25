use anchor_lang::prelude::*;

use crate::error::StockRampError;
use crate::events::{BuyOrderCancelledEvent, BuyOrderReducedEvent};
use crate::state::{StockRampOrder, STOCK_RAMP_BUY};

#[derive(Accounts)]
pub struct CancelOrReduceBuyOrder<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stock-ramp-order", buyer.key().as_ref(), stock_ramp_order.seed.to_le_bytes().as_ref()],
        bump = stock_ramp_order.bump,
        has_one = maker @ StockRampError::InvalidMaker,
        constraint = stock_ramp_order.escrow_type == STOCK_RAMP_BUY @ StockRampError::InvalidEscrowType,
        // `close = maker` only fires if new_amount ends up 0 — see handler;
        // Anchor can't conditionally close, so full closure (rent reclaim)
        // is handled manually inside the handler instead of via this attribute.
    )]
    pub stock_ramp_order: Account<'info, StockRampOrder>,

    /// CHECK: validated via has_one above
    #[account(mut)]
    pub maker: AccountInfo<'info>,
}

pub fn cancel_or_reduce_buy_order(ctx: Context<CancelOrReduceBuyOrder>, new_amount: u64) -> Result<()> {
    let order = &mut ctx.accounts.stock_ramp_order;

    let total_reserved: u64 = order
        .reserved_amounts
        .iter()
        .filter(|r| r.status == 0 || r.status == 1 || r.status == 4) // pending/payment_sent/disputed
        .map(|r| r.amount)
        .sum();

    require!(new_amount >= total_reserved, StockRampError::CannotReduceBelowReserved);

    let original_amount = order.amount;
    order.amount = new_amount;

    if new_amount == 0 && order.reserved_amounts.is_empty() {
        // Fully cancelled, no in-flight reservations — reclaim rent manually
        // (buy orders never hold tokens directly, so no ATA/CPI needed here).
        let order_info = ctx.accounts.stock_ramp_order.to_account_info();
        let lamports = order_info.lamports();
        **ctx.accounts.maker.lamports.borrow_mut() = ctx
            .accounts
            .maker
            .lamports()
            .checked_add(lamports)
            .ok_or(StockRampError::ArithmeticOverflow)?;
        **order_info.lamports.borrow_mut() = 0;
        let mut data = order_info.try_borrow_mut_data()?;
        for byte in data.iter_mut() {
            *byte = 0;
        }

        emit!(BuyOrderCancelledEvent {
            stock_ramp_order: ctx.accounts.stock_ramp_order.key(),
            buyer: ctx.accounts.buyer.key(),
            original_amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
    } else {
        emit!(BuyOrderReducedEvent {
            stock_ramp_order: ctx.accounts.stock_ramp_order.key(),
            buyer: ctx.accounts.buyer.key(),
            original_amount,
            new_amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
    }

    Ok(())
}

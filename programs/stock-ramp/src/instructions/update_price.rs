use anchor_lang::prelude::*;

use crate::error::StockRampError;
use crate::events::PriceUpdatedEvent;
use crate::state::StockRampOrder;

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    pub maker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stock-ramp-order", maker.key().as_ref(), stock_ramp_order.seed.to_le_bytes().as_ref()],
        bump = stock_ramp_order.bump,
        has_one = maker @ StockRampError::InvalidMaker,
    )]
    pub stock_ramp_order: Account<'info, StockRampOrder>,
}

pub fn update_price(ctx: Context<UpdatePrice>, new_price_per_token: u64) -> Result<()> {
    require!(new_price_per_token > 0, StockRampError::InvalidPrice);

    let order = &mut ctx.accounts.stock_ramp_order;
    let old_price = order.price_per_token;
    order.price_per_token = new_price_per_token;

    emit!(PriceUpdatedEvent {
        stock_ramp_order: order.key(),
        maker: ctx.accounts.maker.key(),
        old_price,
        new_price: new_price_per_token,
        currency: String::from_utf8_lossy(&order.currency).to_string(),
    });
    Ok(())
}

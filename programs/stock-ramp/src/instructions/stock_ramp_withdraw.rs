use anchor_lang::prelude::*;
use anchor_spl::token_interface::{close_account, transfer_checked, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::compute_dust_threshold;
use crate::error::StockRampError;
use crate::events::{OrderClosedEvent, PartialWithdrawalEvent};
use crate::state::StockRampOrder;

// was express_withdraw
#[derive(Accounts)]
pub struct StockRampWithdraw<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stock-ramp-order", maker.key().as_ref(), stock_ramp_order.seed.to_le_bytes().as_ref()],
        bump = stock_ramp_order.bump,
        has_one = maker @ StockRampError::InvalidMaker,
    )]
    pub stock_ramp_order: Account<'info, StockRampOrder>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub maker_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = stock_ramp_order,
        token::token_program = token_program,
    )]
    pub stock_ramp_order_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn stock_ramp_withdraw(ctx: Context<StockRampWithdraw>, withdraw_amount: u64) -> Result<()> {
    let order = &mut ctx.accounts.stock_ramp_order;
    require!(order.amount >= withdraw_amount, StockRampError::InvalidWithdrawAmount);

    let has_active_reservations = order
        .reserved_amounts
        .iter()
        .any(|r| r.status == 0 || r.status == 1 || r.status == 4);

    let sr_maker = order.maker;
    let sr_seed_bytes = order.seed.to_le_bytes();
    let sr_bump = order.bump;
    let signer_seeds: &[&[u8]] = &[b"stock-ramp-order", sr_maker.as_ref(), &sr_seed_bytes, &[sr_bump]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                to: ctx.accounts.maker_ata.to_account_info(),
                authority: ctx.accounts.stock_ramp_order.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
            },
            &[signer_seeds],
        ),
        withdraw_amount,
        ctx.accounts.mint.decimals,
    )?;

    let order = &mut ctx.accounts.stock_ramp_order;
    order.amount = order
        .amount
        .checked_sub(withdraw_amount)
        .ok_or(StockRampError::ArithmeticOverflow)?;

    let stock_ramp_order_key = order.key();
    let remaining_amount = order.amount;

    ctx.accounts.stock_ramp_order_ata.reload()?;
    let ata_balance = ctx.accounts.stock_ramp_order_ata.amount;
    let dust = compute_dust_threshold(ctx.accounts.mint.decimals);

    if !has_active_reservations && ata_balance <= dust {
        if ata_balance > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                        to: ctx.accounts.maker_ata.to_account_info(),
                        authority: ctx.accounts.stock_ramp_order.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                    },
                    &[signer_seeds],
                ),
                ata_balance,
                ctx.accounts.mint.decimals,
            )?;
        }

       close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                destination: ctx.accounts.maker.to_account_info(),
                authority: ctx.accounts.stock_ramp_order.to_account_info(),
            },
            &[signer_seeds],
        ))?;

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

        emit!(OrderClosedEvent {
            stock_ramp_order: stock_ramp_order_key,
            maker: sr_maker,
            remaining_amount: 0,
        });
    } else {
        emit!(PartialWithdrawalEvent {
            stock_ramp_order: stock_ramp_order_key,
            maker: sr_maker,
            withdrawal_amount: withdraw_amount,
            remaining_amount,
        });
    }

    Ok(())
}

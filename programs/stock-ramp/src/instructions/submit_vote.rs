use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use solana_keccak_hasher::hashv;

use crate::constants::compute_dust_threshold;
use crate::error::StockRampError;
use crate::events::{OrderClosedEvent, ValidatorVoteCastEvent, ValidatorVoteExecutedEvent};
use crate::state::{GlobalState, StockRampOrder, ValidatorEarnings, ValidatorVote};
use crate::utils::get_token_account_owner;

pub const VOTE_EXPIRY_SECONDS: i64 = 30 * 60; // 30 minutes

pub const VALIDATOR_EARNINGS_SPACE: usize = 8 + ValidatorEarnings::INIT_SPACE;

fn reference_hash(payout_reference: &str) -> [u8; 32] {
    hashv(&[payout_reference.as_bytes()]).to_bytes()
}

/// Split: 20% platform / 60% maker / 20% validator pool
/// Validator pool receives the true remainder to avoid dust loss.
/// Returns (platform_fee, maker_fee, validator_pool_fee)
fn split_fee(total_fee: u64) -> Result<(u64, u64, u64)> {
    let platform_fee = total_fee
        .checked_mul(20)
        .ok_or(StockRampError::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(StockRampError::ArithmeticOverflow)?;

    let maker_fee = total_fee
        .checked_mul(60)
        .ok_or(StockRampError::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(StockRampError::ArithmeticOverflow)?;

    let validator_pool_fee = total_fee
        .checked_sub(platform_fee)
        .ok_or(StockRampError::ArithmeticOverflow)?
        .checked_sub(maker_fee)
        .ok_or(StockRampError::ArithmeticOverflow)?;

    Ok((platform_fee, maker_fee, validator_pool_fee))
}

/// Credits each participating validator's ValidatorEarnings PDA from remaining_accounts.
/// See original Trust Vault implementation for full behavior notes — unchanged here
/// except for renamed types/seeds.
fn credit_validator_earnings<'info>(
    voters: &[Pubkey; 5],
    validator_pool_fee: u64,
    mint_key: Pubkey,
    clock_ts: i64,
    _signing_validator_key: Pubkey,
    signing_validator_info: &AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
    system_program: &AccountInfo<'info>,
) -> Result<u64> {
    let active_voters: Vec<Pubkey> = voters
        .iter()
        .filter(|v| **v != Pubkey::default())
        .cloned()
        .collect();

    let voter_count = active_voters.len() as u64;
    if voter_count == 0 || validator_pool_fee == 0 {
        return Ok(0);
    }

    let per_validator = validator_pool_fee
        .checked_div(voter_count)
        .ok_or(StockRampError::ArithmeticOverflow)?;

    let remainder = validator_pool_fee
        .checked_sub(
            per_validator
                .checked_mul(voter_count)
                .ok_or(StockRampError::ArithmeticOverflow)?,
        )
        .ok_or(StockRampError::ArithmeticOverflow)?;

    let mut uncredited: u64 = 0;

    for (i, voter_key) in active_voters.iter().enumerate() {
        let share = if i == 0 {
            per_validator
                .checked_add(remainder)
                .ok_or(StockRampError::ArithmeticOverflow)?
        } else {
            per_validator
        };

        let (expected_pda, bump) = Pubkey::find_program_address(
            &[b"validator-earnings", voter_key.as_ref(), mint_key.as_ref()],
            &crate::ID,
        );

        let earnings_account = remaining_accounts
            .iter()
            .find(|a| a.key() == expected_pda)
            .cloned();

        match earnings_account {
            Some(account_info) => {
                if account_info.data_is_empty() {
                    let space = VALIDATOR_EARNINGS_SPACE;
                    let rent = Rent::get()?;
                    let lamports = rent.minimum_balance(space);

                    anchor_lang::system_program::transfer(
                        CpiContext::new(
                            system_program.to_account_info(),
                            anchor_lang::system_program::Transfer {
                                from: signing_validator_info.to_account_info(),
                                to: account_info.clone(),
                            },
                        ),
                        lamports,
                    )?;

                    let pda_seeds: &[&[u8]] = &[
                        b"validator-earnings",
                        voter_key.as_ref(),
                        mint_key.as_ref(),
                        &[bump],
                    ];
                    let pda_signer_seeds = &[pda_seeds];

                    anchor_lang::system_program::allocate(
                        CpiContext::new_with_signer(
                            system_program.to_account_info(),
                            anchor_lang::system_program::Allocate {
                                account_to_allocate: account_info.clone(),
                            },
                            pda_signer_seeds,
                        ),
                        space as u64,
                    )?;

                    anchor_lang::system_program::assign(
                        CpiContext::new_with_signer(
                            system_program.to_account_info(),
                            anchor_lang::system_program::Assign {
                                account_to_assign: account_info.clone(),
                            },
                            pda_signer_seeds,
                        ),
                        &crate::ID,
                    )?;

                    let earnings = ValidatorEarnings {
                        validator: *voter_key,
                        mint: mint_key,
                        accumulated_amount: share,
                        total_earned: share,
                        total_credits: 1,
                        last_credited_at: clock_ts,
                        bump,
                    };

                    let mut data = account_info.try_borrow_mut_data()?;
                    let mut write_buf = &mut data[..];
                    earnings.try_serialize(&mut write_buf)?;

                    msg!(
                        "ValidatorEarnings PDA created and credited {} tokens for validator {}",
                        share,
                        voter_key
                    );
                } else {
                    let mut earnings: ValidatorEarnings =
                        ValidatorEarnings::try_deserialize(&mut &account_info.data.borrow()[..])?;

                    require_keys_eq!(
                        earnings.validator,
                        *voter_key,
                        StockRampError::UnauthorizedValidator
                    );
                    require_keys_eq!(earnings.mint, mint_key, StockRampError::InvalidMint);

                    earnings.accumulated_amount = earnings
                        .accumulated_amount
                        .checked_add(share)
                        .ok_or(StockRampError::ArithmeticOverflow)?;
                    earnings.total_earned = earnings
                        .total_earned
                        .checked_add(share)
                        .ok_or(StockRampError::ArithmeticOverflow)?;
                    earnings.total_credits += 1;
                    earnings.last_credited_at = clock_ts;

                    let mut data = account_info.try_borrow_mut_data()?;
                    let mut write_buf = &mut data[..];
                    earnings.try_serialize(&mut write_buf)?;

                    msg!(
                        "Credited {} tokens to validator {} earnings",
                        share,
                        voter_key
                    );
                }
            }
            None => {
                msg!(
                    "ValidatorEarnings PDA for {} not provided — {} tokens redirected to platform",
                    voter_key,
                    share
                );
                uncredited = uncredited
                    .checked_add(share)
                    .ok_or(StockRampError::ArithmeticOverflow)?;
            }
        }
    }

    Ok(uncredited)
}

// =======================================================================
// BUY-SIDE vote
// =======================================================================

#[derive(Accounts)]
#[instruction(reference_hash: [u8; 32])]
pub struct SubmitBuyVote<'info> {
    #[account(mut)]
    pub validator: Signer<'info>,

    #[account(mut, seeds = [b"global-state"], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        mut,
        seeds = [
            b"stock-ramp-order",
            stock_ramp_order.maker.as_ref(),
            &stock_ramp_order.seed.to_le_bytes(),
        ],
        bump = stock_ramp_order.bump,
    )]
    pub stock_ramp_order: Box<Account<'info, StockRampOrder>>,

    #[account(
        init_if_needed,
        payer = validator,
        space = 8 + ValidatorVote::INIT_SPACE,
        seeds = [
            b"validator-vote",
            stock_ramp_order.key().as_ref(),
            reference_hash.as_ref(),
        ],
        bump
    )]
    pub validator_vote: Box<Account<'info, ValidatorVote>>,

    /// CHECK: validated against stock_ramp_order.maker — mut for lamport return on close
    #[account(mut)]
    pub maker: AccountInfo<'info>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = stock_ramp_order,
        token::token_program = token_program,
    )]
    pub stock_ramp_order_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: platform fee destination ATA — receives 20% of fee
    #[account(mut)]
    pub fee_destination_ata: AccountInfo<'info>,

    /// CHECK: taker ATA — used for refunds on failure
    #[account(mut)]
    pub taker_ata: AccountInfo<'info>,
    /// CHECK: maker ATA — receives principal + 60% fee rebate on success; dust on close
    #[account(mut)]
    pub maker_ata: AccountInfo<'info>,

    /// CHECK: dedicated pool authority PDA — signs validator pool ATA transfers.
    /// Validated against global_state.validator_fee_pool_authority in handler.
    #[account(seeds = [b"validator-fee-pool-authority"], bump)]
    pub validator_fee_pool_authority: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = validator_fee_pool_authority,
        associated_token::token_program = token_program,
    )]
    pub validator_fee_pool_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    // remaining_accounts: up to 5 ValidatorEarnings PDAs (one per voter)
}

pub fn submit_buy_vote<'info>(
    ctx: Context<'_, '_, '_, 'info, SubmitBuyVote<'info>>,
    reference_hash_arg: [u8; 32],
    payout_reference: String,
    taker: Pubkey,
    amount: u64,
    fiat_amount: u64,
    currency: String,
    vote: bool,
    evidence: String,
) -> Result<()> {
    let validator_key = ctx.accounts.validator.key();

    let expected_hash = self::reference_hash(&payout_reference);
    require!(
        reference_hash_arg == expected_hash,
        StockRampError::InvalidReferenceHash
    );

    require!(
        ctx.accounts
            .global_state
            .validators
            .contains(&validator_key),
        StockRampError::UnauthorizedValidator
    );

    require_keys_eq!(
        ctx.accounts.validator_fee_pool_authority.key(),
        ctx.accounts.global_state.validator_fee_pool_authority,
        StockRampError::InvalidPoolAuthority
    );

    let clock = Clock::get()?;
    {
        let va = &mut ctx.accounts.validator_vote;
        if !va.executed && va.created_at == 0 {
            va.stock_ramp_order = ctx.accounts.stock_ramp_order.key();
            va.taker = taker;
            va.reference_hash = reference_hash_arg;
            va.votes_for = 0;
            va.votes_against = 0;
            va.voters = [Pubkey::default(); 5];
            va.vote_results = [false; 5];
            va.executed = false;
            va.created_at = clock.unix_timestamp;
            va.expires_at = clock.unix_timestamp + VOTE_EXPIRY_SECONDS;
            va.is_buy_order = true;
            va.bump = ctx.bumps.validator_vote;
            ctx.accounts.global_state.active_vote_count += 1;
        }
    }

    require!(
        !ctx.accounts.validator_vote.executed,
        StockRampError::VoteAlreadyExecuted
    );
    require!(
        clock.unix_timestamp < ctx.accounts.validator_vote.expires_at,
        StockRampError::VoteExpired
    );
    require!(
        !ctx.accounts.validator_vote.voters.contains(&validator_key),
        StockRampError::AlreadyVoted
    );
    require_keys_eq!(
        ctx.accounts.maker.key(),
        ctx.accounts.stock_ramp_order.maker,
        StockRampError::InvalidMaker
    );

    let slot = ctx
        .accounts
        .validator_vote
        .voters
        .iter()
        .position(|v| *v == Pubkey::default())
        .ok_or(StockRampError::VoteSlotsFull)?;

    ctx.accounts.validator_vote.voters[slot] = validator_key;
    ctx.accounts.validator_vote.vote_results[slot] = vote;

    if vote {
        ctx.accounts.validator_vote.votes_for += 1;
    } else {
        ctx.accounts.validator_vote.votes_against += 1;
    }

    let votes_for = ctx.accounts.validator_vote.votes_for;
    let votes_against = ctx.accounts.validator_vote.votes_against;
    let threshold = ctx.accounts.global_state.required_votes;
    let val_count = ctx.accounts.global_state.validator_count;

    emit!(ValidatorVoteCastEvent {
        stock_ramp_order: ctx.accounts.stock_ramp_order.key(),
        validator: validator_key,
        payout_reference: payout_reference.clone(),
        vote,
        votes_for,
        votes_against,
        timestamp: clock.unix_timestamp,
    });

    let impossible_to_approve = votes_against > (val_count - threshold);
    let should_execute = votes_for >= threshold || impossible_to_approve;
    let execute_success = votes_for >= threshold;

    if should_execute {
        ctx.accounts.validator_vote.executed = true;
        ctx.accounts.global_state.active_vote_count = ctx
            .accounts
            .global_state
            .active_vote_count
            .saturating_sub(1);

        let sr_maker = ctx.accounts.stock_ramp_order.maker;
        let sr_seed_bytes = ctx.accounts.stock_ramp_order.seed.to_le_bytes();
        let sr_bump = ctx.accounts.stock_ramp_order.bump;
        let sr_fee_pct = ctx.accounts.stock_ramp_order.fee_percentage;
        let stock_ramp_order_key = ctx.accounts.stock_ramp_order.key();
        let mint_key = ctx.accounts.mint.key();
        let mint_decimals = ctx.accounts.mint.decimals;

        let seeds = &[
            b"stock-ramp-order" as &[u8],
            sr_maker.as_ref(),
            &sr_seed_bytes[..],
            &[sr_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let pool_authority_bump = ctx.bumps.validator_fee_pool_authority;
        let pool_seeds = &[
            b"validator-fee-pool-authority" as &[u8],
            &[pool_authority_bump],
        ];
        let pool_signer_seeds = &[&pool_seeds[..]];

        let idx = ctx
            .accounts
            .stock_ramp_order
            .reserved_amounts
            .iter()
            .position(|r| {
                r.taker == taker && r.payout_reference.as_ref() == Some(&payout_reference)
            })
            .ok_or(StockRampError::ReservationNotFound)?;

        require!(
            ctx.accounts.stock_ramp_order.reserved_amounts[idx].status == 0,
            StockRampError::ReservationAlreadyProcessed
        );

        // The taker's original InstantPaymentReserved reservation locks in
        // `reserved_amounts[idx].amount` in base units. `amount` here is a
        // free-form instruction argument passed by whichever validator
        // submits the vote — nothing upstream constrained it to match the
        // reservation before this point. Without this check a validator
        // could pass an `amount` different from what was actually reserved,
        // and every downstream calculation (fee split, maker payout, taker
        // refund, total_volume) would run on the wrong number. The sell-side
        // vote doesn't have this hole because it reads `amount` straight off
        // the reservation (see reserved_amounts[idx].amount a few lines down
        // in submit_sell_vote) instead of trusting an argument.
        require!(
            ctx.accounts.stock_ramp_order.reserved_amounts[idx].amount == amount,
            StockRampError::ReservationAmountMismatch
        );

        if execute_success {
            ctx.accounts.stock_ramp_order.reserved_amounts[idx].status = 2;

            let total_fee = if sr_fee_pct > 0 {
                amount
                    .checked_mul(sr_fee_pct as u64)
                    .ok_or(StockRampError::ArithmeticOverflow)?
                    .checked_div(10000)
                    .ok_or(StockRampError::ArithmeticOverflow)?
            } else {
                0
            };

            let (platform_fee, maker_fee, validator_pool_fee) = split_fee(total_fee)?;

            if platform_fee > 0 {
                require!(
                    ctx.accounts.fee_destination_ata.key() != Pubkey::default()
                        && *ctx.accounts.fee_destination_ata.owner != system_program::ID,
                    StockRampError::MissingFeeDestinationAta
                );
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                            to: ctx.accounts.fee_destination_ata.to_account_info(),
                            authority: ctx.accounts.stock_ramp_order.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    platform_fee,
                    mint_decimals,
                )?;
            }

            if validator_pool_fee > 0 {
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                            to: ctx.accounts.validator_fee_pool_ata.to_account_info(),
                            authority: ctx.accounts.stock_ramp_order.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    validator_pool_fee,
                    mint_decimals,
                )?;
            }

            let voters = ctx.accounts.validator_vote.voters;
            let uncredited = credit_validator_earnings(
                &voters,
                validator_pool_fee,
                mint_key,
                clock.unix_timestamp,
                validator_key,
                &ctx.accounts.validator.to_account_info(),
                ctx.remaining_accounts,
                &ctx.accounts.system_program.to_account_info(),
            )?;

            if uncredited > 0 {
                require!(
                    ctx.accounts.fee_destination_ata.key() != Pubkey::default()
                        && *ctx.accounts.fee_destination_ata.owner != system_program::ID,
                    StockRampError::MissingFeeDestinationAta
                );
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.validator_fee_pool_ata.to_account_info(),
                            to: ctx.accounts.fee_destination_ata.to_account_info(),
                            authority: ctx.accounts.validator_fee_pool_authority.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                        },
                        pool_signer_seeds,
                    ),
                    uncredited,
                    mint_decimals,
                )?;
            }

            let maker_receives = amount
                .checked_sub(total_fee)
                .ok_or(StockRampError::ArithmeticOverflow)?
                .checked_add(maker_fee)
                .ok_or(StockRampError::ArithmeticOverflow)?;

            if maker_receives > 0 {
                require!(
                    ctx.accounts.maker_ata.key() != Pubkey::default()
                        && *ctx.accounts.maker_ata.owner != system_program::ID,
                    StockRampError::MissingMakerAta
                );
                let owner =
                    get_token_account_owner(&ctx.accounts.maker_ata, &ctx.accounts.token_program)?;
                require_keys_eq!(
                    owner,
                    ctx.accounts.maker.key(),
                    StockRampError::InvalidMakerAtaAuthority
                );

                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                            to: ctx.accounts.maker_ata.to_account_info(),
                            authority: ctx.accounts.stock_ramp_order.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    maker_receives,
                    mint_decimals,
                )?;
            }

            ctx.accounts.global_state.total_volume = ctx
                .accounts
                .global_state
                .total_volume
                .checked_add(amount)
                .ok_or(StockRampError::ArithmeticOverflow)?;
            ctx.accounts.global_state.total_confirmations += 1;
            if total_fee > 0 {
                ctx.accounts.global_state.total_fees_collected = ctx
                    .accounts
                    .global_state
                    .total_fees_collected
                    .checked_add(total_fee)
                    .ok_or(StockRampError::ArithmeticOverflow)?;
            }
        } else {
            ctx.accounts.stock_ramp_order.amount = ctx
                .accounts
                .stock_ramp_order
                .amount
                .checked_add(amount)
                .ok_or(StockRampError::ArithmeticOverflow)?;

            require!(
                ctx.accounts.taker_ata.key() != Pubkey::default()
                    && *ctx.accounts.taker_ata.owner != system_program::ID,
                StockRampError::MissingTakerAtaForRefund
            );
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                        to: ctx.accounts.taker_ata.to_account_info(),
                        authority: ctx.accounts.stock_ramp_order.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                amount,
                mint_decimals,
            )?;
        }

        ctx.accounts.stock_ramp_order.reserved_amounts.remove(idx);

        emit!(ValidatorVoteExecutedEvent {
            stock_ramp_order: stock_ramp_order_key,
            taker,
            payout_reference: payout_reference.clone(),
            success: execute_success,
            message: evidence,
            amount,
            fiat_amount,
            currency,
            timestamp: clock.unix_timestamp,
        });

        let order_fully_consumed = ctx.accounts.stock_ramp_order.amount == 0;
        let has_active_reservations = ctx
            .accounts
            .stock_ramp_order
            .reserved_amounts
            .iter()
            .any(|r| r.status == 0);

        ctx.accounts.stock_ramp_order_ata.reload()?;
        let remaining_balance = ctx.accounts.stock_ramp_order_ata.amount;
        let dust_threshold = compute_dust_threshold(mint_decimals);

        if order_fully_consumed && !has_active_reservations && remaining_balance <= dust_threshold {
            if remaining_balance > 0
                && ctx.accounts.maker_ata.key() != Pubkey::default()
                && *ctx.accounts.maker_ata.owner != system_program::ID
            {
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                            to: ctx.accounts.maker_ata.to_account_info(),
                            authority: ctx.accounts.stock_ramp_order.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    remaining_balance,
                    mint_decimals,
                )?;
            }

            token_interface::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                    destination: ctx.accounts.maker.to_account_info(),
                    authority: ctx.accounts.stock_ramp_order.to_account_info(),
                },
                signer_seeds,
            ))?;

            let sr_info = ctx.accounts.stock_ramp_order.to_account_info();
            let sr_lamports = sr_info.lamports();
            **ctx.accounts.maker.lamports.borrow_mut() = ctx
                .accounts
                .maker
                .lamports()
                .checked_add(sr_lamports)
                .ok_or(StockRampError::ArithmeticOverflow)?;
            **sr_info.lamports.borrow_mut() = 0;
            let mut data = sr_info.try_borrow_mut_data()?;
            for byte in data.iter_mut() {
                *byte = 0;
            }

            ctx.accounts.global_state.total_stock_ramp_closed += 1;
            emit!(OrderClosedEvent {
                stock_ramp_order: stock_ramp_order_key,
                maker: sr_maker,
                remaining_amount: 0,
            });
        }
    }

    Ok(())
}

// =======================================================================
// SELL-SIDE vote
// =======================================================================

#[derive(Accounts)]
#[instruction(reference_hash: [u8; 32])]
pub struct SubmitSellVote<'info> {
    #[account(mut)]
    pub validator: Signer<'info>,

    #[account(mut, seeds = [b"global-state"], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        mut,
        seeds = [
            b"stock-ramp-order",
            stock_ramp_order.maker.as_ref(),
            &stock_ramp_order.seed.to_le_bytes(),
        ],
        bump = stock_ramp_order.bump,
    )]
    pub stock_ramp_order: Box<Account<'info, StockRampOrder>>,

    #[account(
        init_if_needed,
        payer = validator,
        space = 8 + ValidatorVote::INIT_SPACE,
        seeds = [
            b"validator-vote",
            stock_ramp_order.key().as_ref(),
            reference_hash.as_ref(),
        ],
        bump
    )]
    pub validator_vote: Box<Account<'info, ValidatorVote>>,

    /// CHECK: validated against stock_ramp_order.maker
    #[account(mut)]
    pub maker: AccountInfo<'info>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = stock_ramp_order,
        token::token_program = token_program,
    )]
    pub stock_ramp_order_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: platform fee destination ATA
    #[account(mut)]
    pub fee_destination_ata: AccountInfo<'info>,

    /// CHECK: taker (buyer) ATA — receives tokens on success
    #[account(mut)]
    pub taker_ata: AccountInfo<'info>,
    /// CHECK: maker ATA — receives 60% fee rebate + dust sweep on close
    #[account(mut)]
    pub maker_ata: AccountInfo<'info>,

    /// CHECK: dedicated pool authority PDA
    #[account(seeds = [b"validator-fee-pool-authority"], bump)]
    pub validator_fee_pool_authority: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = validator_fee_pool_authority,
        associated_token::token_program = token_program,
    )]
    pub validator_fee_pool_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    // remaining_accounts: up to 5 ValidatorEarnings PDAs (one per voter)
}

pub fn submit_sell_vote<'info>(
    ctx: Context<'_, '_, '_, 'info, SubmitSellVote<'info>>,
    reference_hash_arg: [u8; 32],
    payout_reference: String,
    taker: Pubkey,
    vote: bool,
    evidence: String,
) -> Result<()> {
    let validator_key = ctx.accounts.validator.key();

    let expected_hash = self::reference_hash(&payout_reference);
    require!(
        reference_hash_arg == expected_hash,
        StockRampError::InvalidReferenceHash
    );

    require!(
        ctx.accounts
            .global_state
            .validators
            .contains(&validator_key),
        StockRampError::UnauthorizedValidator
    );

    require_keys_eq!(
        ctx.accounts.validator_fee_pool_authority.key(),
        ctx.accounts.global_state.validator_fee_pool_authority,
        StockRampError::InvalidPoolAuthority
    );

    let clock = Clock::get()?;
    {
        let va = &mut ctx.accounts.validator_vote;
        if !va.executed && va.created_at == 0 {
            va.stock_ramp_order = ctx.accounts.stock_ramp_order.key();
            va.taker = taker;
            va.reference_hash = reference_hash_arg;
            va.votes_for = 0;
            va.votes_against = 0;
            va.voters = [Pubkey::default(); 5];
            va.vote_results = [false; 5];
            va.executed = false;
            va.created_at = clock.unix_timestamp;
            va.expires_at = clock.unix_timestamp + VOTE_EXPIRY_SECONDS;
            va.is_buy_order = false;
            va.bump = ctx.bumps.validator_vote;
            ctx.accounts.global_state.active_vote_count += 1;
        }
    }

    require!(
        !ctx.accounts.validator_vote.executed,
        StockRampError::VoteAlreadyExecuted
    );
    require!(
        clock.unix_timestamp < ctx.accounts.validator_vote.expires_at,
        StockRampError::VoteExpired
    );
    require!(
        !ctx.accounts.validator_vote.voters.contains(&validator_key),
        StockRampError::AlreadyVoted
    );
    require_keys_eq!(
        ctx.accounts.maker.key(),
        ctx.accounts.stock_ramp_order.maker,
        StockRampError::InvalidMaker
    );

    let slot = ctx
        .accounts
        .validator_vote
        .voters
        .iter()
        .position(|v| *v == Pubkey::default())
        .ok_or(StockRampError::VoteSlotsFull)?;

    ctx.accounts.validator_vote.voters[slot] = validator_key;
    ctx.accounts.validator_vote.vote_results[slot] = vote;

    if vote {
        ctx.accounts.validator_vote.votes_for += 1;
    } else {
        ctx.accounts.validator_vote.votes_against += 1;
    }

    let votes_for = ctx.accounts.validator_vote.votes_for;
    let votes_against = ctx.accounts.validator_vote.votes_against;
    let threshold = ctx.accounts.global_state.required_votes;
    let val_count = ctx.accounts.global_state.validator_count;

    emit!(ValidatorVoteCastEvent {
        stock_ramp_order: ctx.accounts.stock_ramp_order.key(),
        validator: validator_key,
        payout_reference: payout_reference.clone(),
        vote,
        votes_for,
        votes_against,
        timestamp: clock.unix_timestamp,
    });

    let impossible_to_approve = votes_against > (val_count - threshold);
    let should_execute = votes_for >= threshold || impossible_to_approve;
    let execute_success = votes_for >= threshold;

    if should_execute {
        ctx.accounts.validator_vote.executed = true;
        ctx.accounts.global_state.active_vote_count = ctx
            .accounts
            .global_state
            .active_vote_count
            .saturating_sub(1);

        let sr_maker = ctx.accounts.stock_ramp_order.maker;
        let sr_seed_bytes = ctx.accounts.stock_ramp_order.seed.to_le_bytes();
        let sr_bump = ctx.accounts.stock_ramp_order.bump;
        let sr_fee_pct = ctx.accounts.stock_ramp_order.fee_percentage;
        let stock_ramp_order_key = ctx.accounts.stock_ramp_order.key();
        let currency = String::from_utf8_lossy(&ctx.accounts.stock_ramp_order.currency).to_string();
        let mint_key = ctx.accounts.mint.key();
        let mint_decimals = ctx.accounts.mint.decimals;

        let seeds = &[
            b"stock-ramp-order" as &[u8],
            sr_maker.as_ref(),
            &sr_seed_bytes[..],
            &[sr_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let pool_authority_bump = ctx.bumps.validator_fee_pool_authority;
        let pool_seeds = &[
            b"validator-fee-pool-authority" as &[u8],
            &[pool_authority_bump],
        ];
        let pool_signer_seeds = &[&pool_seeds[..]];

        let idx = ctx
            .accounts
            .stock_ramp_order
            .reserved_amounts
            .iter()
            .position(|r| {
                r.taker == taker && r.payout_reference.as_ref() == Some(&payout_reference)
            })
            .ok_or(StockRampError::ReservationNotFound)?;

        require!(
            ctx.accounts.stock_ramp_order.reserved_amounts[idx].status == 0,
            StockRampError::ReservationAlreadyProcessed
        );

        let amount = ctx.accounts.stock_ramp_order.reserved_amounts[idx].amount;
        let fiat_amount = ctx.accounts.stock_ramp_order.reserved_amounts[idx].fiat_amount;

        if execute_success {
            let total_fee = if sr_fee_pct > 0 {
                amount
                    .checked_mul(sr_fee_pct as u64)
                    .ok_or(StockRampError::ArithmeticOverflow)?
                    .checked_div(10000)
                    .ok_or(StockRampError::ArithmeticOverflow)?
            } else {
                0
            };

            let (platform_fee, maker_fee, validator_pool_fee) = split_fee(total_fee)?;
            let taker_receives = amount
                .checked_sub(total_fee)
                .ok_or(StockRampError::ArithmeticOverflow)?;

            if platform_fee > 0 {
                require!(
                    ctx.accounts.fee_destination_ata.key() != Pubkey::default()
                        && *ctx.accounts.fee_destination_ata.owner != system_program::ID,
                    StockRampError::MissingFeeDestinationAta
                );
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                            to: ctx.accounts.fee_destination_ata.to_account_info(),
                            authority: ctx.accounts.stock_ramp_order.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    platform_fee,
                    mint_decimals,
                )?;
            }

            if validator_pool_fee > 0 {
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                            to: ctx.accounts.validator_fee_pool_ata.to_account_info(),
                            authority: ctx.accounts.stock_ramp_order.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    validator_pool_fee,
                    mint_decimals,
                )?;
            }

            let voters = ctx.accounts.validator_vote.voters;
            let uncredited = credit_validator_earnings(
                &voters,
                validator_pool_fee,
                mint_key,
                clock.unix_timestamp,
                validator_key,
                &ctx.accounts.validator.to_account_info(),
                ctx.remaining_accounts,
                &ctx.accounts.system_program.to_account_info(),
            )?;

            if uncredited > 0 {
                require!(
                    ctx.accounts.fee_destination_ata.key() != Pubkey::default()
                        && *ctx.accounts.fee_destination_ata.owner != system_program::ID,
                    StockRampError::MissingFeeDestinationAta
                );
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.validator_fee_pool_ata.to_account_info(),
                            to: ctx.accounts.fee_destination_ata.to_account_info(),
                            authority: ctx.accounts.validator_fee_pool_authority.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                        },
                        pool_signer_seeds,
                    ),
                    uncredited,
                    mint_decimals,
                )?;
            }

            if maker_fee > 0
                && ctx.accounts.maker_ata.key() != Pubkey::default()
                && *ctx.accounts.maker_ata.owner != system_program::ID
            {
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                            to: ctx.accounts.maker_ata.to_account_info(),
                            authority: ctx.accounts.stock_ramp_order.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    maker_fee,
                    mint_decimals,
                )?;
            }

            require!(
                ctx.accounts.taker_ata.key() != Pubkey::default()
                    && *ctx.accounts.taker_ata.owner != system_program::ID,
                StockRampError::MissingTakerAta
            );
            let owner =
                get_token_account_owner(&ctx.accounts.taker_ata, &ctx.accounts.token_program)?;
            require_keys_eq!(owner, taker, StockRampError::InvalidTakerAtaAuthority);

            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                        to: ctx.accounts.taker_ata.to_account_info(),
                        authority: ctx.accounts.stock_ramp_order.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                taker_receives,
                mint_decimals,
            )?;

            ctx.accounts.global_state.total_volume = ctx
                .accounts
                .global_state
                .total_volume
                .checked_add(amount)
                .ok_or(StockRampError::ArithmeticOverflow)?;
            ctx.accounts.global_state.total_confirmations += 1;
            if total_fee > 0 {
                ctx.accounts.global_state.total_fees_collected = ctx
                    .accounts
                    .global_state
                    .total_fees_collected
                    .checked_add(total_fee)
                    .ok_or(StockRampError::ArithmeticOverflow)?;
            }

            ctx.accounts.stock_ramp_order.reserved_amounts[idx].status = 2;
        } else {
            ctx.accounts.stock_ramp_order.amount = ctx
                .accounts
                .stock_ramp_order
                .amount
                .checked_add(amount)
                .ok_or(StockRampError::ArithmeticOverflow)?;
        }

        ctx.accounts.stock_ramp_order.reserved_amounts.remove(idx);

        emit!(ValidatorVoteExecutedEvent {
            stock_ramp_order: stock_ramp_order_key,
            taker,
            payout_reference: payout_reference.clone(),
            success: execute_success,
            message: evidence,
            amount,
            fiat_amount,
            currency,
            timestamp: clock.unix_timestamp,
        });

        let has_active_reservations = ctx
            .accounts
            .stock_ramp_order
            .reserved_amounts
            .iter()
            .any(|r| r.status == 0);

        ctx.accounts.stock_ramp_order_ata.reload()?;
        let remaining_balance = ctx.accounts.stock_ramp_order_ata.amount;
        let dust_threshold = compute_dust_threshold(mint_decimals);

        if !has_active_reservations && remaining_balance <= dust_threshold {
            if remaining_balance > 0
                && ctx.accounts.maker_ata.key() != Pubkey::default()
                && *ctx.accounts.maker_ata.owner != system_program::ID
            {
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                            to: ctx.accounts.maker_ata.to_account_info(),
                            authority: ctx.accounts.stock_ramp_order.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    remaining_balance,
                    mint_decimals,
                )?;
            }

            token_interface::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                    destination: ctx.accounts.maker.to_account_info(),
                    authority: ctx.accounts.stock_ramp_order.to_account_info(),
                },
                signer_seeds,
            ))?;

            let sr_info = ctx.accounts.stock_ramp_order.to_account_info();
            let sr_lamports = sr_info.lamports();
            **ctx.accounts.maker.lamports.borrow_mut() = ctx
                .accounts
                .maker
                .lamports()
                .checked_add(sr_lamports)
                .ok_or(StockRampError::ArithmeticOverflow)?;
            **sr_info.lamports.borrow_mut() = 0;
            let mut data = sr_info.try_borrow_mut_data()?;
            for byte in data.iter_mut() {
                *byte = 0;
            }

            ctx.accounts.global_state.total_stock_ramp_closed += 1;
            emit!(OrderClosedEvent {
                stock_ramp_order: stock_ramp_order_key,
                maker: sr_maker,
                remaining_amount: 0,
            });
        }
    }

    Ok(())
}

// =======================================================================
// Finalize expired vote
// =======================================================================

#[derive(Accounts)]
pub struct FinalizeExpiredVote<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(mut, seeds = [b"global-state"], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        mut,
        seeds = [b"validator-vote", stock_ramp_order.key().as_ref(), &validator_vote.reference_hash],
        bump = validator_vote.bump,
        close = caller,
    )]
    pub validator_vote: Box<Account<'info, ValidatorVote>>,

    #[account(
        mut,
        seeds = [
            b"stock-ramp-order",
            stock_ramp_order.maker.as_ref(),
            &stock_ramp_order.seed.to_le_bytes(),
        ],
        bump = stock_ramp_order.bump,
    )]
    pub stock_ramp_order: Box<Account<'info, StockRampOrder>>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = stock_ramp_order,
        token::token_program = token_program,
    )]
    pub stock_ramp_order_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: taker ATA for refund
    #[account(mut)]
    pub taker_ata: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn finalize_expired_vote(
    ctx: Context<FinalizeExpiredVote>,
    payout_reference: String,
) -> Result<()> {
    let clock = Clock::get()?;

    require!(
        !ctx.accounts.validator_vote.executed,
        StockRampError::VoteAlreadyExecuted
    );
    require!(
        clock.unix_timestamp >= ctx.accounts.validator_vote.expires_at,
        StockRampError::VoteNotYetExpired
    );

    let expected_hash = self::reference_hash(&payout_reference);
    require!(
        ctx.accounts.validator_vote.reference_hash == expected_hash,
        StockRampError::InvalidReferenceHash
    );

    ctx.accounts.global_state.active_vote_count = ctx
        .accounts
        .global_state
        .active_vote_count
        .saturating_sub(1);

    let taker = ctx.accounts.validator_vote.taker;
    let sr_maker = ctx.accounts.stock_ramp_order.maker;
    let sr_seed_bytes = ctx.accounts.stock_ramp_order.seed.to_le_bytes();
    let sr_bump = ctx.accounts.stock_ramp_order.bump;

    let idx = ctx
        .accounts
        .stock_ramp_order
        .reserved_amounts
        .iter()
        .position(|r| {
            r.taker == taker
                && r.status == 0
                && r.payout_reference.as_deref() == Some(payout_reference.as_str())
        })
        .ok_or(StockRampError::ReservationNotFound)?;

    let amount = ctx.accounts.stock_ramp_order.reserved_amounts[idx].amount;

    let seeds = &[
        b"stock-ramp-order" as &[u8],
        sr_maker.as_ref(),
        &sr_seed_bytes[..],
        &[sr_bump],
    ];
    let signer_seeds = &[&seeds[..]];

    require!(
        ctx.accounts.taker_ata.key() != Pubkey::default()
            && *ctx.accounts.taker_ata.owner != system_program::ID,
        StockRampError::MissingTakerAtaForRefund
    );

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.stock_ramp_order_ata.to_account_info(),
                to: ctx.accounts.taker_ata.to_account_info(),
                authority: ctx.accounts.stock_ramp_order.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    if ctx.accounts.validator_vote.is_buy_order {
        ctx.accounts.stock_ramp_order.amount = ctx
            .accounts
            .stock_ramp_order
            .amount
            .checked_add(amount)
            .ok_or(StockRampError::ArithmeticOverflow)?;
    }

    ctx.accounts.stock_ramp_order.reserved_amounts[idx].status = 3;
    ctx.accounts.stock_ramp_order.reserved_amounts.remove(idx);

    // validator_vote PDA closed by Anchor's `close = caller` constraint
    Ok(())
}

// =======================================================================
// Close executed vote
// =======================================================================

#[derive(Accounts)]
pub struct CloseExecutedVote<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        close = caller,
        constraint = validator_vote.executed @ StockRampError::VoteNotYetExecuted,
        seeds = [
            b"validator-vote",
            validator_vote.stock_ramp_order.as_ref(),
            &validator_vote.reference_hash,
        ],
        bump = validator_vote.bump,
    )]
    pub validator_vote: Box<Account<'info, ValidatorVote>>,

    pub system_program: Program<'info, System>,
}

pub fn close_executed_vote(_ctx: Context<CloseExecutedVote>) -> Result<()> {
    Ok(())
}

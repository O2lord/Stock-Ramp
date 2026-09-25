use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

// Confirmed live on devnet — this is the real deployed program ID, not a
// placeholder (verified via Solscan: initializeGlobalState + a prior
// deployWithMaxDataLen both landed against this exact address). Keep this,
// client/lib/constant.ts's STOCK_RAMP_PROGRAM_ID, and
// client/relics/stock_ramp.ts's embedded `address` field all in sync if
// this program is ever redeployed to a new keypair.
declare_id!("5DLaeZGr4dFhoQkx2hu7QmUYGiS5qmBuNehB5fzGaUkH");

#[program]
pub mod stock_ramp {
    use super::*;

    // -------------------- Admin --------------------
    pub fn initialize_global_state(ctx: Context<InitializeGlobalState>) -> Result<()> {
        instructions::admin::initialize_global_state(ctx)
    }

    pub fn update_fee_percentage(ctx: Context<AdminAction>, new_fee: u16) -> Result<()> {
        instructions::admin::update_fee_percentage(ctx, new_fee)
    }

    pub fn update_fee_destination(
        ctx: Context<AdminAction>,
        new_destination: Pubkey,
    ) -> Result<()> {
        instructions::admin::update_fee_destination(ctx, new_destination)
    }

    pub fn pause_buy_orders(ctx: Context<AdminAction>, paused: bool) -> Result<()> {
        instructions::admin::pause_buy_orders(ctx, paused)
    }

    pub fn pause_sell_orders(ctx: Context<AdminAction>, paused: bool) -> Result<()> {
        instructions::admin::pause_sell_orders(ctx, paused)
    }

    pub fn register_validator(ctx: Context<AdminAction>, validator: Pubkey) -> Result<()> {
        instructions::admin::register_validator(ctx, validator)
    }

    pub fn remove_validator(ctx: Context<AdminAction>, validator: Pubkey) -> Result<()> {
        instructions::admin::remove_validator(ctx, validator)
    }

    pub fn update_required_votes(ctx: Context<AdminAction>, n: u8) -> Result<()> {
        instructions::admin::update_required_votes(ctx, n)
    }

    // -------------------- Orders --------------------
    pub fn create_buy_order(
        ctx: Context<CreateBuyOrder>,
        seed: u64,
        amount: u64,
        price_per_token: u64,
        currency: String,
        payment_instructions: String,
        flutterwave_credential_id: String,
    ) -> Result<()> {
        instructions::create_buy_order::create_buy_order(
            ctx,
            seed,
            amount,
            price_per_token,
            currency,
            payment_instructions,
            flutterwave_credential_id,
        )
    }

    pub fn create_sell_order(
        ctx: Context<CreateSellOrder>,
        seed: u64,
        amount: u64,
        price_per_token: u64,
        currency: String,
        payment_instructions: String,
        flutterwave_credential_id: String,
    ) -> Result<()> {
        instructions::create_sell_order::create_sell_order(
            ctx,
            seed,
            amount,
            price_per_token,
            currency,
            payment_instructions,
            flutterwave_credential_id,
        )
    }

    pub fn cancel_or_reduce_buy_order(
        ctx: Context<CancelOrReduceBuyOrder>,
        new_amount: u64,
    ) -> Result<()> {
        instructions::cancel_or_reduce_buy_order::cancel_or_reduce_buy_order(ctx, new_amount)
    }

    pub fn get_validator_earnings(ctx: Context<GetValidatorEarnings>) -> Result<()> {
        instructions::get_validator_earnings(ctx)
    }
    pub fn instant_reserve(
        ctx: Context<InstantReserve>,
        amount: u64,
        fiat_amount: u64,
        currency: String,
        payout_details: Option<String>,
    ) -> Result<()> {
        instructions::instant_reserve::handler(ctx, amount, fiat_amount, currency, payout_details)
    }

    pub fn instant_sell_reserve(
        ctx: Context<InstantSellReserve>,
        amount: u64,
        payment_mode: u8,
        buyer_payout_details: Option<String>,
        payout_reference: String,
    ) -> Result<()> {
        instructions::instant_sell_reserve::handler(
            ctx,
            amount,
            payment_mode,
            buyer_payout_details,
            payout_reference,
        )
    }

    pub fn initialize_validator_fee_pool_ata(
        ctx: Context<InitializeValidatorFeePoolAta>,
    ) -> Result<()> {
        instructions::initialize_validator_fee_pool_ata(ctx)
    }

    pub fn stock_ramp_withdraw(
        ctx: Context<StockRampWithdraw>,
        withdraw_amount: u64,
    ) -> Result<()> {
        instructions::stock_ramp_withdraw::stock_ramp_withdraw(ctx, withdraw_amount)
    }

    pub fn update_price(ctx: Context<UpdatePrice>, new_price_per_token: u64) -> Result<()> {
        instructions::update_price::update_price(ctx, new_price_per_token)
    }

    // -------------------- Validators --------------------
    pub fn submit_buy_vote<'info>(
        ctx: Context<'_, '_, '_, 'info, SubmitBuyVote<'info>>,
        reference_hash: [u8; 32],
        payout_reference: String,
        taker: Pubkey,
        amount: u64,
        fiat_amount: u64,
        currency: String,
        vote: bool,
        evidence: String,
    ) -> Result<()> {
        instructions::submit_vote::submit_buy_vote(
            ctx,
            reference_hash,
            payout_reference,
            taker,
            amount,
            fiat_amount,
            currency,
            vote,
            evidence,
        )
    }

    pub fn submit_sell_vote<'info>(
        ctx: Context<'_, '_, '_, 'info, SubmitSellVote<'info>>,
        reference_hash: [u8; 32],
        payout_reference: String,
        taker: Pubkey,
        vote: bool,
        evidence: String,
    ) -> Result<()> {
        instructions::submit_vote::submit_sell_vote(
            ctx,
            reference_hash,
            payout_reference,
            taker,
            vote,
            evidence,
        )
    }

    pub fn finalize_expired_vote(
        ctx: Context<FinalizeExpiredVote>,
        payout_reference: String,
    ) -> Result<()> {
        instructions::submit_vote::finalize_expired_vote(ctx, payout_reference)
    }

    pub fn close_executed_vote(ctx: Context<CloseExecutedVote>) -> Result<()> {
        instructions::submit_vote::close_executed_vote(ctx)
    }
}

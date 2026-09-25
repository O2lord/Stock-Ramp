use anchor_lang::prelude::*;

use crate::state::ValidatorEarnings;

#[derive(Accounts)]
pub struct GetValidatorEarnings<'info> {
    pub validator_earnings: Account<'info, ValidatorEarnings>,
}

pub fn get_validator_earnings(_ctx: Context<GetValidatorEarnings>) -> Result<()> {
    Ok(())
}

#![allow(unexpected_cfgs)]

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;


use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("CGcWhMjmnRmB3B283VKaZsvB76uVqoVbmG6kKk9NQuPB");
#[program]
pub mod amm_dex {
    // use anchor_spl::token::accessor::authority;

    use super::*;

    pub fn initialize(ctx: Context<Initialize>, seed: u64, fee: u16, authority: Option<Pubkey>) -> Result<()> {
            ctx.accounts.initialize(seed, fee, authority, &ctx.bumps)
        }
}

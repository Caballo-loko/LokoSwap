use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::state::Config;

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint_x: Box<Account<'info, Mint>>,
    pub mint_y: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = admin,
        seeds = [b"lp", config.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = config,
    )]
    pub mint_lp: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = mint_x,
        associated_token::authority = config
    )]
    pub vault_x: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = mint_y,
        associated_token::authority = config,
    )]
    pub vault_y: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = admin,
        seeds = [b"config",seed.to_le_bytes().as_ref()],
        bump,
        space = Config::INIT_SPACE
    )]
    pub config: Account<'info, Config>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> Initialize<'info> {
    pub fn initialize(
        &mut self,
        seed: u64,
        fee: u16,
        authority: Option<Pubkey>,
        bumps: &InitializeBumps,
    ) -> Result<()> {
        self.config.set_inner(Config {
            seed,
            authority,
            mint_x: self.mint_x.key(),
            mint_y: self.mint_y.key(),
            fee,
            locked: false,
            config_bump: bumps.config,
            lp_bump: bumps.mint_lp,
        });
        Ok(())
    }
}

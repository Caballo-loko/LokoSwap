use anchor_lang::prelude::*;

#[account]
// #[derive(InitSpace)]
pub struct Config{
    pub seed: u64,
    pub mint_x: Pubkey,
    pub mint_y: Pubkey,
    pub fee: u16,
    pub locked: bool,
    pub lp_bump: u8,
    pub config_bump: u8 ,
    pub authority: Option<Pubkey>,
}

impl Space for Config {
    const INIT_SPACE: usize = 8 + 12 + 1 + 2 + 32*2 + 32 + 1 + 8;
}
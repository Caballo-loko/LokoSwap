use anchor_lang::prelude::*;

#[account]
// #[derive(InitSpace)]
pub struct Config {
    pub seed: u64,                 // 8 bytes
    pub mint_x: Pubkey,            // 32 bytes
    pub mint_y: Pubkey,            // 32 bytes
    pub fee: u16,                  // 2 bytes
    pub locked: bool,              // 1 byte
    pub lp_bump: u8,               // 1 byte
    pub config_bump: u8,           // 1 byte
    pub authority: Option<Pubkey>, // 1 (tag) + 32 (Pubkey) = 33 bytes
}

impl Space for Config {
    const INIT_SPACE: usize = 
        8 + // discriminator
        8 + // seed
        32 + // mint_x
        32 + // mint_y
        2 + // fee
        1 + // locked
        1 + // lp_bump
        1 + // config_bump
        1 + // authority tag
        32; // authority Pubkey
}
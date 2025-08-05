use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub seed: u64,
    pub authority: Option<Pubkey>,
    pub mint_x: Pubkey,
    pub mint_y: Pubkey,
    pub fee: u16,
    pub locked: bool,
    pub lp_bump: u8,
    pub config_bump: u8,
    
    // Token-2022 Extension Configuration
    pub fee_destination: Pubkey,
    pub default_transfer_fee_basis_points: u16,      // Default: 50 = 0.5%
    pub default_transfer_fee_max: u64,               // Max fee in base units
    pub fee_withdraw_authority: Pubkey,              // PDA for fee collection
    pub default_hook_program: Option<Pubkey>,        // Default hook program
    
    // Extension flags for runtime detection
    pub supports_transfer_fees: bool,
    pub supports_transfer_hooks: bool,
    pub supports_metadata: bool,
    pub supports_interest_bearing: bool,
    
    // Whitelisted hook programs for security
    #[max_len(10)]
    pub approved_hook_programs: Vec<Pubkey>,
}

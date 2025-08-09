#![allow(unexpected_cfgs)]
#[warn(deprecated)]

pub mod constants;
pub mod error;
pub mod instructions;
pub mod services;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("5zJ1miHbyLMqSEhZZxqQV3ECUzu6TPi1JhUSpwMFQVPh");

#[program]
pub mod loko_swap {
    use super::*;

    /// Initialize a new AMM pool with support for Token 2022 extensions
    /// 
    /// # Arguments
    /// * `seed` - Unique seed for this pool
    /// * `fee` - Trading fee in basis points (max 1000 = 10%)
    /// * `authority` - Optional authority for pool management
    /// * `transfer_fee_basis_points` - Default transfer fee for new tokens (basis points)
    /// * `max_transfer_fee` - Maximum transfer fee in base units
    /// * `hook_program_id` - Optional default hook program for transfers
    pub fn initialize<'info>(
        ctx: Context<'_, '_, 'info, 'info, Initialize<'info>>,
        seed: u64,
        fee: u16,
        authority: Option<Pubkey>,
        transfer_fee_basis_points: u16,
        max_transfer_fee: u64,
        hook_program_id: Option<Pubkey>,
    ) -> Result<()> {
        ctx.accounts.initialize(
            seed, 
            fee, 
            authority, 
            transfer_fee_basis_points,
            max_transfer_fee,
            hook_program_id,
            &ctx.bumps,
            ctx.remaining_accounts
        )
    }

    /// Deposit tokens into the AMM pool to receive LP tokens
    /// Handles Token 2022 extensions including transfer fees and hooks
    /// 
    /// # Arguments
    /// * `amount` - Amount of LP tokens to mint
    /// * `max_x` - Maximum amount of token X to deposit (including fees)
    /// * `max_y` - Maximum amount of token Y to deposit (including fees)
    /// 
    /// # Transfer Hook Support
    /// Token-2022 handles all hook account resolution automatically.
    /// No additional accounts need to be provided via remaining_accounts.
    pub fn deposit<'info>(
        ctx: Context<'_, '_, 'info, 'info, Deposit<'info>>,
        amount: u64,
        max_x: u64,
        max_y: u64,
    ) -> Result<()> {
        ctx.accounts.deposit(amount, max_x, max_y, ctx.remaining_accounts)
    }

    /// Withdraw tokens from the AMM pool by burning LP tokens
    /// Handles Token 2022 extensions including transfer fees and hooks
    /// 
    /// # Arguments
    /// * `amount` - Amount of LP tokens to burn
    /// * `min_x` - Minimum amount of token X to receive (after fees)
    /// * `min_y` - Minimum amount of token Y to receive (after fees)
    /// 
    /// # Transfer Hook Support
    /// Token-2022 handles all hook account resolution automatically.
    /// No additional accounts need to be provided via remaining_accounts.
    pub fn withdraw<'info>(
        ctx: Context<'_, '_, 'info, 'info, Withdraw<'info>>,
        amount: u64,
        min_x: u64,
        min_y: u64,
    ) -> Result<()> {
        ctx.accounts.withdraw(amount, min_x, min_y, ctx.remaining_accounts)
    }

    /// Swap tokens in the AMM pool
    /// Handles Token 2022 extensions including transfer fees and hooks
    /// 
    /// # Arguments
    /// * `amount` - Amount of input tokens to swap
    /// * `is_x` - True if swapping X for Y, false if swapping Y for X
    /// * `min` - Minimum amount of output tokens to receive (after fees)
    /// 
    /// # Transfer Fee Handling
    /// For input tokens with transfer fees: The specified amount includes fees
    /// For output tokens with transfer fees: The AMM pays the fees to ensure user receives `min` amount
    /// 
    /// # Transfer Hook Support
    /// Token-2022 handles all hook account resolution automatically.
    /// No additional accounts need to be provided via remaining_accounts.
    pub fn swap<'info>(
        ctx: Context<'_, '_, 'info, 'info, Swap<'info>>,
        amount: u64,
        is_x: bool,
        min: u64,
    ) -> Result<()> {
        ctx.accounts.swap(is_x, amount, min, ctx.remaining_accounts)
    }

    /// Lock the pool to prevent deposits, withdrawals, and swaps
    /// Only callable by the pool authority
    pub fn lock(ctx: Context<Update>) -> Result<()> {
        ctx.accounts.lock()
    }

    /// Unlock the pool to allow deposits, withdrawals, and swaps
    /// Only callable by the pool authority
    pub fn unlock(ctx: Context<Update>) -> Result<()> {
        ctx.accounts.unlock()
    }

    /// Collect transfer fees from Token-2022 accounts
    /// Only callable by the pool authority
    /// 
    /// # Arguments
    /// Additional accounts from which to collect fees should be passed via remaining_accounts.
    /// These accounts must contain withheld transfer fees for the specified mint.
    pub fn collect_fees<'info>(
        ctx: Context<'_, '_, 'info, 'info, CollectFees<'info>>,
    ) -> Result<()> {
        ctx.accounts.collect_fees(ctx.remaining_accounts)
    }

    /// Update transfer fee configuration for the pool
    /// Only callable by the pool authority
    /// 
    /// # Arguments
    /// * `new_fee_basis_points` - New default transfer fee (basis points, max 10000)
    /// * `new_max_fee` - New maximum transfer fee in base units
    pub fn update_transfer_fee_config(
        ctx: Context<CollectFees>,
        new_fee_basis_points: u16,
        new_max_fee: u64,
    ) -> Result<()> {
        ctx.accounts.update_transfer_fee_config(new_fee_basis_points, new_max_fee)
    }

    /// Update the fee destination account
    /// Only callable by the pool authority
    /// 
    /// # Arguments
    /// * `new_destination` - New account to receive collected fees
    pub fn update_fee_destination(
        ctx: Context<CollectFees>,
        new_destination: Pubkey,
    ) -> Result<()> {
        ctx.accounts.update_fee_destination(new_destination)
    }

    /// Update the default hook program
    /// Only callable by the pool authority
    /// 
    /// # Arguments
    /// * `new_hook_program` - New default hook program (None to remove)
    pub fn update_hook_program(
        ctx: Context<CollectFees>,
        new_hook_program: Option<Pubkey>,
    ) -> Result<()> {
        ctx.accounts.update_hook_program(new_hook_program)
    }
}
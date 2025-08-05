use anchor_lang::prelude::*;
use anchor_spl::{
    token_interface::{Mint, TokenAccount, TokenInterface},
    token_2022_extensions::transfer_fee::{
        withdraw_withheld_tokens_from_accounts, WithdrawWithheldTokensFromAccounts,
    },
};

use crate::{error::AmmError, state::Config};

#[derive(Accounts)]
pub struct Update<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config", config.seed.to_be_bytes().as_ref()],
        bump = config.config_bump
    )]
    pub config: Account<'info, Config>,
}

/// Account structure for collecting transfer fees from Token-2022 mints
#[derive(Accounts)]
pub struct CollectFees<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"config", config.seed.to_be_bytes().as_ref()],
        bump = config.config_bump,
        constraint = config.authority == Some(authority.key()) @ AmmError::InvalidAuthority
    )]
    pub config: Account<'info, Config>,

    /// The mint from which to collect transfer fees
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Destination account for collected fees
    #[account(mut)]
    pub fee_destination: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    // remaining_accounts: accounts from which to withdraw fees
}

impl<'info> Update<'info> {
    pub fn lock(&mut self) -> Result<()> {
        require!(
            self.config.authority == Some(self.user.key()),
            AmmError::InvalidAuthority
        );

        self.config.locked = true;

        Ok(())
    }

    pub fn unlock(&mut self) -> Result<()> {
        require!(
            self.config.authority == Some(self.user.key()),
            AmmError::InvalidAuthority
        );

        self.config.locked = false;

        Ok(())
    }
}

impl<'info> CollectFees<'info> {
    /// Collect withheld transfer fees from specified token accounts
    /// This function can collect fees from multiple accounts in a single transaction
    pub fn collect_fees(&mut self, remaining_accounts: &[AccountInfo<'info>]) -> Result<()> {
        require!(
            !remaining_accounts.is_empty(),
            AmmError::InvalidAmount
        );

        // Verify the config has fee collection authority
        require!(
            self.config.fee_withdraw_authority == self.config.key(),
            AmmError::InvalidAuthority
        );

        // Set up the CPI context with signer (config PDA)
        let seeds = &[
            b"config",
            &self.config.seed.to_be_bytes()[..],
            &[self.config.config_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = WithdrawWithheldTokensFromAccounts {
            destination: self.fee_destination.to_account_info(),
            authority: self.config.to_account_info(),
            mint: self.mint.to_account_info(),
            token_program_id: self.token_program.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        ).with_remaining_accounts(remaining_accounts.to_vec());

        // Execute the fee collection
        let sources = remaining_accounts.to_vec();
        withdraw_withheld_tokens_from_accounts(cpi_ctx, sources)?;

        msg!("Successfully collected transfer fees from {} accounts", remaining_accounts.len());
        
        Ok(())
    }

    /// Update transfer fee configuration (if the mint supports it)
    pub fn update_transfer_fee_config(&mut self, new_fee_basis_points: u16, new_max_fee: u64) -> Result<()> {
        require!(new_fee_basis_points <= 10000, AmmError::InvalidFee);
        
        // Update the config's default values
        self.config.default_transfer_fee_basis_points = new_fee_basis_points;
        self.config.default_transfer_fee_max = new_max_fee;

        msg!("Updated default transfer fee config: {} basis points, max {}", 
             new_fee_basis_points, new_max_fee);

        Ok(())
    }

    /// Update the fee destination account
    pub fn update_fee_destination(&mut self, new_destination: Pubkey) -> Result<()> {
        self.config.fee_destination = new_destination;
        
        msg!("Updated fee destination to: {}", new_destination);
        
        Ok(())
    }

    /// Update the default hook program
    pub fn update_hook_program(&mut self, new_hook_program: Option<Pubkey>) -> Result<()> {
        self.config.default_hook_program = new_hook_program;
        
        if let Some(program_id) = new_hook_program {
            msg!("Updated default hook program to: {}", program_id);
        } else {
            msg!("Removed default hook program");
        }
        
        Ok(())
    }
}

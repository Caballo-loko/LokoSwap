use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
        transfer_checked_with_fee, TransferCheckedWithFee,
    },
};

use crate::{
    error::AmmError, 
    state::Config,
    utils::token_utils::TokenExtensions
};
use constant_product_curve::ConstantProduct;
use constant_product_curve::LiquidityPair;

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub mint_x: InterfaceAccount<'info, Mint>,
    pub mint_y: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_x,
        associated_token::authority = user,
        associated_token::token_program = token_program
    )]
    pub user_x: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_y,
        associated_token::authority = user,
        associated_token::token_program = token_program
    )]
    pub user_y: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = config,
        associated_token::token_program = token_program
    )]
    pub vault_x: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = config,
        associated_token::token_program = token_program
    )]
    pub vault_y: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"config", config.seed.to_be_bytes().as_ref()],
        bump = config.config_bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [b"lp", config.key().as_ref()],
        bump = config.lp_bump
    )]
    pub mint_lp: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_lp,
        associated_token::authority = user
    )]
    pub user_lp: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl<'info> Swap<'info> {
    pub fn swap(
        &mut self,
        is_x: bool,
        amount: u64,
        min: u64,
        remaining_accounts: &[AccountInfo<'info>]
    ) -> Result<()> {
        // Manual validation replacing has_one constraints
        require!(self.config.mint_x == self.mint_x.key(), AmmError::InvalidToken);
        require!(self.config.mint_y == self.mint_y.key(), AmmError::InvalidToken);
        
        // Get extension information for both tokens (scoped to minimize stack lifetime)
        let (input_mint, output_mint) = if is_x {
            (&self.mint_x, &self.mint_y)
        } else {
            (&self.mint_y, &self.mint_x)
        };

        // Calculate net amount that will reach the vault after input fees
        let input_fee = {
            let input_ext = TokenExtensions::new(&input_mint.to_account_info())?;
            input_ext.calculate_fee(amount)
        };
        let net_amount_in = amount.saturating_sub(input_fee);
        
        require!(net_amount_in > 0, AmmError::InvalidAmount);

        // Get the actual vault amounts (accounting for any transfer fees on previous deposits)
        let vault_x_amount = self.vault_x.amount;
        let vault_y_amount = self.vault_y.amount;

        // Initialize the curve with current vault amounts
        let mut curve = ConstantProduct::init(
            vault_x_amount,
            vault_y_amount,
            self.mint_lp.supply,
            self.config.fee,
            None,
        )
        .map_err(|_| AmmError::MathOverflow)?;

        let p = match is_x {
            true => LiquidityPair::X,
            false => LiquidityPair::Y,
        };

        // Calculate swap amounts using NET input amount (what actually reaches the vault)
        let res = curve.swap(p, net_amount_in, min)
            .map_err(|_| AmmError::SlippageExceeded)?;

        // For output with transfer fees, calculate gross amount needed
        let gross_output = {
            let output_ext = TokenExtensions::new(&output_mint.to_account_info())?;
            output_ext.calculate_gross_for_net(res.withdraw)
        };

        // Verify vault has enough tokens to cover the gross withdrawal
        let vault_balance = if is_x {
            self.vault_y.amount
        } else {
            self.vault_x.amount
        };
        require!(gross_output <= vault_balance, AmmError::InsufficientFunds);

        // Perform the actual transfers
        // Input: user pays gross amount (including fees)
        self.deposit_tokens(is_x, amount, remaining_accounts)?;
        // Output: vault sends gross amount (user receives net after fees)
        self.withdraw_tokens(!is_x, gross_output, remaining_accounts)?;

        Ok(())
    }


    pub fn deposit_tokens(
        &mut self,
        is_x: bool,
        amount: u64,
        remaining_accounts: &[AccountInfo<'info>]
    ) -> Result<()> {
        let (from, to, mint) = if is_x {
            (
                &self.user_x,
                &self.vault_x,
                &self.mint_x,
            )
        } else {
            (
                &self.user_y,
                &self.vault_y,
                &self.mint_y,
            )
        };

        let decimals = mint.decimals;
        let cpi_program = self.token_program.to_account_info();

        // Get extension information using centralized utilities
        let extensions = TokenExtensions::new(&mint.to_account_info())?;

        match (extensions.has_transfer_fee, extensions.has_transfer_hook) {
            // Token with transfer fee (no hook)
            (true, false) => {
                let cpi_accounts = TransferCheckedWithFee {
                    source: from.to_account_info(),
                    destination: to.to_account_info(),
                    authority: self.user.to_account_info(),
                    mint: mint.to_account_info(),
                    token_program_id: cpi_program.clone(),
                };
                let ctx = CpiContext::new(cpi_program, cpi_accounts);
                let expected_fee = extensions.calculate_fee(amount);
                transfer_checked_with_fee(ctx, amount, decimals, expected_fee)?;
            }
            
            // Token with transfer hook (prioritized per PDF guidance)
            (_, true) => {
                let cpi_accounts = TransferChecked {
                    from: from.to_account_info(),
                    to: to.to_account_info(),
                    authority: self.user.to_account_info(),
                    mint: mint.to_account_info(),
                };
                
                let mut ctx = CpiContext::new(cpi_program, cpi_accounts);
                
                // Add remaining accounts for transfer hook
                if !remaining_accounts.is_empty() {
                    ctx = ctx.with_remaining_accounts(remaining_accounts.to_vec());
                }
                
                transfer_checked(ctx, amount, decimals)?;
            }
            
            // Standard token (no extensions)
            (false, false) => {
                let cpi_accounts = TransferChecked {
                    from: from.to_account_info(),
                    to: to.to_account_info(),
                    authority: self.user.to_account_info(),
                    mint: mint.to_account_info(),
                };
                let ctx = CpiContext::new(cpi_program, cpi_accounts);
                transfer_checked(ctx, amount, decimals)?;
            }
        }

        Ok(())
    }

    pub fn withdraw_tokens(
        &mut self,
        is_x: bool,
        amount: u64,
        remaining_accounts: &[AccountInfo<'info>]
    ) -> Result<()> {
        let (from, to, mint) = if is_x {
            (
                &self.vault_x,
                &self.user_x,
                &self.mint_x,
            )
        } else {
            (
                &self.vault_y,
                &self.user_y,
                &self.mint_y,
            )
        };

        let seeds = &[
            b"config",
            &self.config.seed.to_be_bytes()[..],
            &[self.config.config_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let decimals = mint.decimals;
        let cpi_program = self.token_program.to_account_info();

        // Get extension information using centralized utilities
        let extensions = TokenExtensions::new(&mint.to_account_info())?;

        match (extensions.has_transfer_fee, extensions.has_transfer_hook) {
            // Token with transfer fee (no hook)
            (true, false) => {
                let cpi_accounts = TransferCheckedWithFee {
                    source: from.to_account_info(),
                    destination: to.to_account_info(),
                    authority: self.config.to_account_info(),
                    mint: mint.to_account_info(),
                    token_program_id: cpi_program.clone(),
                };
                let ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                let expected_fee = extensions.calculate_fee(amount);
                transfer_checked_with_fee(ctx, amount, decimals, expected_fee)?;
            }
            
            // Token with transfer hook (prioritized per PDF guidance)
            (_, true) => {
                let cpi_accounts = TransferChecked {
                    from: from.to_account_info(),
                    to: to.to_account_info(),
                    authority: self.config.to_account_info(),
                    mint: mint.to_account_info(),
                };
                
                let mut ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                
                // Add remaining accounts for transfer hook
                if !remaining_accounts.is_empty() {
                    ctx = ctx.with_remaining_accounts(remaining_accounts.to_vec());
                }
                
                transfer_checked(ctx, amount, decimals)?;
            }
            
            // Standard token (no extensions)
            (false, false) => {
                let cpi_accounts = TransferChecked {
                    from: from.to_account_info(),
                    to: to.to_account_info(),
                    authority: self.config.to_account_info(),
                    mint: mint.to_account_info(),
                };
                let ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                transfer_checked(ctx, amount, decimals)?;
            }
        }

        Ok(())
    }
}
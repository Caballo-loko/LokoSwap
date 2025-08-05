use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        mint_to, transfer_checked, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
        transfer_checked_with_fee, TransferCheckedWithFee,
    },
};

use crate::{
    error::AmmError, 
    state::Config,
    utils::token_utils::TokenExtensions
};
use constant_product_curve::ConstantProduct;

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub mint_x: InterfaceAccount<'info, Mint>,
    pub mint_y: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = user,
        associated_token::token_program = token_program
    )]
    pub user_x: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
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

impl<'info> Deposit<'info> {
    pub fn deposit(
        &mut self,
        amount: u64,
        max_x: u64,
        max_y: u64,
        remaining_accounts: &[AccountInfo<'info>],
    ) -> Result<()> {
        require!(self.config.locked == false, AmmError::PoolLocked);
        require!(amount > 0, AmmError::InvalidAmount);
        
        // Manual validation replacing has_one constraints
        require!(self.config.mint_x == self.mint_x.key(), AmmError::InvalidToken);
        require!(self.config.mint_y == self.mint_y.key(), AmmError::InvalidToken);

        // Calculate transfer fees (scoped to minimize stack lifetime)
        let (x_transfer_fee, y_transfer_fee) = {
            let x_ext = TokenExtensions::new(&self.mint_x.to_account_info())?;
            let y_ext = TokenExtensions::new(&self.mint_y.to_account_info())?;
            (x_ext.calculate_fee(max_x), y_ext.calculate_fee(max_y))
        };

        // Net amounts that will actually reach the vault (after fees)
        let net_max_x = max_x.saturating_sub(x_transfer_fee);
        let net_max_y = max_y.saturating_sub(y_transfer_fee);

        require!(net_max_x > 0 && net_max_y > 0, AmmError::InvalidAmount);

        let (x, y) = if self.mint_lp.supply == 0 
            && self.vault_x.amount == 0 
            && self.vault_y.amount == 0 
        {
            // Initial deposit - use net amounts
            (net_max_x, net_max_y)
        } else {
            // Calculate required amounts based on current pool ratio
            let amounts = ConstantProduct::xy_deposit_amounts_from_l(
                self.vault_x.amount,
                self.vault_y.amount,
                self.mint_lp.supply,
                amount,
                6,
            )
            .map_err(|_| AmmError::MathOverflow)?;

            // Ensure we don't exceed the net amounts user is willing to deposit
            require!(
                amounts.x <= net_max_x && amounts.y <= net_max_y,
                AmmError::SlippageExceeded
            );

            (amounts.x, amounts.y)
        };

        // Calculate the gross amounts needed (including fees) to get the net amounts
        let (gross_x, gross_y) = {
            let x_ext = TokenExtensions::new(&self.mint_x.to_account_info())?;
            let y_ext = TokenExtensions::new(&self.mint_y.to_account_info())?;
            (x_ext.calculate_gross_for_net(x), y_ext.calculate_gross_for_net(y))
        };

        require!(gross_x <= max_x && gross_y <= max_y, AmmError::SlippageExceeded);

        // Perform transfers (these will deduct fees automatically)
        self.deposit_tokens(true, gross_x, remaining_accounts)?;
        self.deposit_tokens(false, gross_y, remaining_accounts)?;

        // Mint LP tokens based on the net amounts that reached the vault
        self.mint_lp_tokens(amount)
    }


    pub fn deposit_tokens(
        &mut self,
        is_x: bool,
        amount: u64,
        remaining_accounts: &[AccountInfo<'info>],
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

        // Get extension information using centralized utilities (boxed for stack efficiency)
        let extensions = TokenExtensions::new(&mint.to_account_info())?;

        match (extensions.has_transfer_fee, extensions.has_transfer_hook) {
            // Token with transfer fee
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
                // The hook accounts should be pre-resolved on the client side
                // and passed in through remaining_accounts
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

    pub fn mint_lp_tokens(&mut self, amount: u64) -> Result<()> {
        let cpi_accounts = MintTo {
            mint: self.mint_lp.to_account_info(),
            to: self.user_lp.to_account_info(),
            authority: self.config.to_account_info(),
        };

        let seeds = &[
            b"config",
            &self.config.seed.to_be_bytes()[..],
            &[self.config.config_bump],
        ];

        let signer_seeds = &[&seeds[..]];

        let ctx = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        
        mint_to(ctx, amount)?;
        Ok(())
    }
}
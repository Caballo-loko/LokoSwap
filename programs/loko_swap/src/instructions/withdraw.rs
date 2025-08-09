use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        burn, transfer_checked, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
        transfer_checked_with_fee, TransferCheckedWithFee,
    },
};
use crate::{
    error::AmmError, 
    state::Config,
    utils::token_utils::{TokenExtensions, invoke_transfer_checked_with_hooks},
};
use constant_product_curve::ConstantProduct;

#[derive(Accounts)]
pub struct Withdraw<'info> {
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
        bump = config.config_bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [b"lp", config.key().as_ref()],
        bump = config.lp_bump
    )]
    pub mint_lp: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint_lp,
        associated_token::authority = user,
        associated_token::token_program = token_program
    )]
    pub user_lp: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl<'info> Withdraw<'info> {
    pub fn withdraw(
        &mut self,
        amount: u64,
        min_x: u64,
        min_y: u64,
        _remaining_accounts: &[AccountInfo<'info>],
    ) -> Result<()> {
        require!(amount > 0, AmmError::InvalidAmount);
        require!(self.user_lp.amount >= amount, AmmError::InsufficientFunds);
        
        // Manual validation replacing has_one constraints
        require!(self.config.mint_x == self.mint_x.key(), AmmError::InvalidToken);
        require!(self.config.mint_y == self.mint_y.key(), AmmError::InvalidToken);
        

        // Calculate base withdrawal amounts
        let amounts = ConstantProduct::xy_withdraw_amounts_from_l(
            self.vault_x.amount,
            self.vault_y.amount,
            self.mint_lp.supply,
            amount,
            6,
        )
        .map_err(|_| AmmError::MathOverflow)?;

        // Calculate transfer fees that will be deducted from withdrawn amounts (scoped)
        let (x_transfer_fee, y_transfer_fee) = {
            let x_ext = TokenExtensions::new(&self.mint_x.to_account_info())?;
            let y_ext = TokenExtensions::new(&self.mint_y.to_account_info())?;
            (x_ext.calculate_fee(amounts.x), y_ext.calculate_fee(amounts.y))
        };

        // Net amounts user will actually receive (after fees)
        let net_x = amounts.x.saturating_sub(x_transfer_fee);
        let net_y = amounts.y.saturating_sub(y_transfer_fee);

        // Check slippage on net amounts (what user actually receives)
        require!(
            net_x >= min_x && net_y >= min_y,
            AmmError::SlippageExceeded
        );

        // Ensure vault has sufficient balance
        require!(
            self.vault_x.amount >= amounts.x && self.vault_y.amount >= amounts.y,
            AmmError::InsufficientFunds
        );

        // Perform withdrawals (transfer fees will be deducted automatically)
        self.withdraw_tokens(true, amounts.x, _remaining_accounts)?;
        self.withdraw_tokens(false, amounts.y, _remaining_accounts)?;

        // Burn LP tokens
        self.burn_lp_tokens(amount)?;

        Ok(())
    }


    pub fn withdraw_tokens(
        &mut self,
        is_x: bool,
        amount: u64,
        _remaining_accounts: &[AccountInfo<'info>],
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
            // Token 2022 with transfer fee only
            (true, false) => {
                msg!("Withdraw: Using Token 2022 transfer_checked_with_fee (fee only, no hooks)");
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
            
            // Token with BOTH transfer fee AND transfer hook - use Token-2022 
            (true, true) => {
                msg!("Withdraw: Using direct spl_token_2022::onchain::invoke_transfer_checked with PDA authority and hooks");
                
                invoke_transfer_checked_with_hooks(
                    &cpi_program.key(),
                    from.to_account_info(),
                    mint.to_account_info(),
                    to.to_account_info(),
                    self.config.to_account_info(),
                    _remaining_accounts,
                    amount,
                    decimals,
                    signer_seeds,
                )?;
            }
            
            // Token with transfer hook only - use Token-2022 
            (false, true) => {
                msg!("Withdraw: Using direct spl_token_2022::onchain::invoke_transfer_checked with PDA authority and hooks (no fees)");
                
                invoke_transfer_checked_with_hooks(
                    &cpi_program.key(),
                    from.to_account_info(),
                    mint.to_account_info(),
                    to.to_account_info(),
                    self.config.to_account_info(),
                    _remaining_accounts,
                    amount,
                    decimals,
                    signer_seeds,
                )?;
            }
            
            // Standard token (no extensions)
            (false, false) => {
                msg!("Withdraw: Using standard transfer_checked (no extensions)");
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

    pub fn burn_lp_tokens(&mut self, amount: u64) -> Result<()> {
        let cpi_accounts = Burn {
            mint: self.mint_lp.to_account_info(),
            from: self.user_lp.to_account_info(),
            authority: self.user.to_account_info(),
        };

        let ctx = CpiContext::new(self.token_program.to_account_info(), cpi_accounts);
        burn(ctx, amount)
    }
}

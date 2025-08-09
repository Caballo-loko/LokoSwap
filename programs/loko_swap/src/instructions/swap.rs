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
    utils::token_utils::{TokenExtensions, invoke_transfer_checked_with_hooks},
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
        _remaining_accounts: &[AccountInfo<'info>]
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

        // Get dynamic fee from transfer hook (if available) or use default
        let dynamic_fee = self.get_dynamic_fee(_remaining_accounts)
            .unwrap_or(self.config.fee as u64) as u16;

        // Initialize the curve with current vault amounts and dynamic fee
        let mut curve = ConstantProduct::init(
            vault_x_amount,
            vault_y_amount,
            self.mint_lp.supply,
            dynamic_fee,
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
        self.deposit_tokens(is_x, amount, _remaining_accounts)?;
        // Output: vault sends gross amount (user receives net after fees)
        self.withdraw_tokens(!is_x, gross_output, _remaining_accounts)?;

        Ok(())
    }


    pub fn deposit_tokens(
        &mut self,
        is_x: bool,
        amount: u64,
        _remaining_accounts: &[AccountInfo<'info>],
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
            // Token with transfer fee only
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
            
            // Token with BOTH transfer fee AND transfer hook - use direct Token-2022 call
            (true, true) => {
                invoke_transfer_checked_with_hooks(
                    &cpi_program.key(),
                    from.to_account_info(),
                    mint.to_account_info(),
                    to.to_account_info(),
                    self.user.to_account_info(),
                    _remaining_accounts,
                    amount,
                    decimals,
                    &[], // No signer seeds needed for user authority
                )?;
            }
            
            // Token with transfer hook only - use direct Token-2022 call
            (false, true) => {
                invoke_transfer_checked_with_hooks(
                    &cpi_program.key(),
                    from.to_account_info(),
                    mint.to_account_info(),
                    to.to_account_info(),
                    self.user.to_account_info(),
                    _remaining_accounts,
                    amount,
                    decimals,
                    &[], // No signer seeds needed for user authority
                )?;
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
            // Token with transfer fee only
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
            
            // Token with BOTH transfer fee AND transfer hook - use direct Token-2022 call
            (true, true) => {
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
            
            // Token with transfer hook only - use direct Token-2022 call
            (false, true) => {
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

    /// Reads dynamic fee from transfer hook fee stats account
    /// Returns None if hook is not available or fee stats cannot be read
    fn get_dynamic_fee(&self, remaining_accounts: &[AccountInfo]) -> Option<u64> {
        // Check which token has transfer hook extension
        let x_extensions = TokenExtensions::new(&self.mint_x.to_account_info()).ok()?;
        let y_extensions = TokenExtensions::new(&self.mint_y.to_account_info()).ok()?;
        
        let hook_program_id = if x_extensions.has_transfer_hook {
            x_extensions.transfer_hook_program_id?
        } else if y_extensions.has_transfer_hook {
            y_extensions.transfer_hook_program_id?
        } else {
            return None; // No hook token in this pool
        };

        // Verify hook program is whitelisted
        if let Some(expected_hook_program) = self.config.default_hook_program {
            if hook_program_id != expected_hook_program {
                return None; // Unauthorized hook program
            }
        }

        // Look for fee stats account in remaining accounts (index 7 based on hook structure)
        if remaining_accounts.len() >= 8 {
            if let Some(fee_stats_account) = remaining_accounts.get(7) {
                if let Ok(fee_stats) = self.parse_dynamic_fee_stats(fee_stats_account) {
                    let dynamic_fee_bp = fee_stats.current_fee_basis_points as u64;
                    msg!("Dynamic fee: {}bp from hook {}", dynamic_fee_bp, hook_program_id);
                    return Some(dynamic_fee_bp);
                }
            }
        }

        None
    }

    /// Parse dynamic fee stats from account data
    /// This is a simplified parser - in production would use proper deserialization
    fn parse_dynamic_fee_stats(&self, account: &AccountInfo) -> Result<DynamicFeeStatsView> {
        let data = account.try_borrow_data()?;
        
        // Skip discriminator (8 bytes) and parse key fields
        if data.len() < 32 {
            return Err(AmmError::InvalidAccountData.into());
        }

        // Parse key fields from the account data
        // This is a simplified version - real implementation would use proper Borsh deserialization
        let current_fee_basis_points = u16::from_le_bytes([data[32], data[33]]);
        let base_fee_basis_points = u16::from_le_bytes([data[34], data[35]]);
        
        // Parse recent transfers array (simplified)
        let mut recent_transfers = [0u64; 6];
        for i in 0..6 {
            let offset = 44 + i * 8;
            if data.len() >= offset + 8 {
                recent_transfers[i] = u64::from_le_bytes([
                    data[offset], data[offset+1], data[offset+2], data[offset+3],
                    data[offset+4], data[offset+5], data[offset+6], data[offset+7]
                ]);
            }
        }

        Ok(DynamicFeeStatsView {
            current_fee_basis_points,
            base_fee_basis_points,
            recent_transfers,
        })
    }
}

/// Simplified view of dynamic fee stats for parsing
#[derive(Debug)]
struct DynamicFeeStatsView {
    pub current_fee_basis_points: u16,
    pub base_fee_basis_points: u16,
    pub recent_transfers: [u64; 6],
}
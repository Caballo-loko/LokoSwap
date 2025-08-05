use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{error::AmmError, state::Config};

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The first token mint - can be Token or Token 2022
    pub mint_x: InterfaceAccount<'info, Mint>,
    
    /// The second token mint - can be Token or Token 2022  
    pub mint_y: InterfaceAccount<'info, Mint>,

    /// LP token mint - created as Token 2022 to support future extensions
    #[account(
        init,
        payer = admin,
        seeds = [b"lp", config.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = config,
        mint::token_program = token_program
    )]
    pub mint_lp: InterfaceAccount<'info, Mint>,

    /// Vault for token X - uses the same token program as mint_x
    #[account(
        init,
        payer = admin,
        associated_token::mint = mint_x,
        associated_token::authority = config,
        associated_token::token_program = token_program_x
    )]
    pub vault_x: InterfaceAccount<'info, TokenAccount>,

    /// Vault for token Y - uses the same token program as mint_y
    #[account(
        init,
        payer = admin,
        associated_token::mint = mint_y,
        associated_token::authority = config,
        associated_token::token_program = token_program_y
    )]
    pub vault_y: InterfaceAccount<'info, TokenAccount>,

    /// AMM configuration account
    #[account(
        init,
        payer = admin,
        seeds = [b"config", seed.to_be_bytes().as_ref()],
        bump,
        space = 8 + Config::INIT_SPACE
    )]
    pub config: Account<'info, Config>,

    /// Token program for LP tokens (Token 2022)
    pub token_program: Interface<'info, TokenInterface>,
    
    /// Token program for mint_x (could be Token or Token 2022)
    /// CHECK: Verified against mint_x owner in validate_token_programs
    pub token_program_x: AccountInfo<'info>,
    
    /// Token program for mint_y (could be Token or Token 2022)  
    /// CHECK: Verified against mint_y owner in validate_token_programs
    pub token_program_y: AccountInfo<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Initialize<'info> {
    pub fn initialize(
        &mut self,
        seed: u64,
        fee: u16,
        authority: Option<Pubkey>,
        transfer_fee_basis_points: u16,
        max_transfer_fee: u64,
        hook_program_id: Option<Pubkey>,
        bumps: &InitializeBumps,
    ) -> Result<()> {
        // Validate fee is reasonable (max 10% = 1000 basis points)
        require!(fee <= 1000, AmmError::InvalidFee);
        require!(transfer_fee_basis_points <= 10000, AmmError::InvalidFee);
        
        // Validate token programs match the mints
        self.validate_token_programs()?;
        
        // Ensure mints are different
        require!(
            self.mint_x.key() != self.mint_y.key(),
            AmmError::IdenticalMints
        );

        // Check for supported Token 2022 extensions
        self.validate_token_extensions()?;

        // Detect extension support
        let x_has_transfer_fee = self.has_transfer_fee(&self.mint_x)?;
        let y_has_transfer_fee = self.has_transfer_fee(&self.mint_y)?;
        let x_has_transfer_hook = self.has_transfer_hook(&self.mint_x)?.is_some();
        let y_has_transfer_hook = self.has_transfer_hook(&self.mint_y)?.is_some();

        // Initialize config with Token-2022 extension support
        self.config.set_inner(Config {
            seed,
            authority,
            mint_x: self.mint_x.key(),
            mint_y: self.mint_y.key(),
            fee,
            locked: false,
            config_bump: bumps.config,
            lp_bump: bumps.mint_lp,
            
            // Token-2022 Extension Configuration
            fee_destination: authority.unwrap_or(self.admin.key()),
            default_transfer_fee_basis_points: transfer_fee_basis_points,
            default_transfer_fee_max: max_transfer_fee,
            fee_withdraw_authority: self.config.key(), // Self as PDA authority
            default_hook_program: hook_program_id,
            
            // Extension support flags
            supports_transfer_fees: x_has_transfer_fee || y_has_transfer_fee,
            supports_transfer_hooks: x_has_transfer_hook || y_has_transfer_hook,
            supports_metadata: false, // Could be extended to check for metadata
            supports_interest_bearing: false, // Could be extended to check for interest bearing
        });

        msg!("AMM initialized with:");
        msg!("  Mint X: {}", self.mint_x.key());
        msg!("  Mint Y: {}", self.mint_y.key());
        msg!("  LP Mint: {}", self.mint_lp.key());
        msg!("  Fee: {} basis points", fee);
        msg!("  Default Transfer Fee: {} basis points", transfer_fee_basis_points);
        msg!("  Max Transfer Fee: {}", max_transfer_fee);
        msg!("  X has transfer fee: {}", x_has_transfer_fee);
        msg!("  Y has transfer fee: {}", y_has_transfer_fee);
        msg!("  X has transfer hook: {}", x_has_transfer_hook);
        msg!("  Y has transfer hook: {}", y_has_transfer_hook);

        Ok(())
    }

    fn validate_token_programs(&self) -> Result<()> {
        // Verify token_program_x matches mint_x owner
        require!(
            self.token_program_x.key() == *self.mint_x.to_account_info().owner,
            AmmError::InvalidTokenProgram
        );

        // Verify token_program_y matches mint_y owner
        require!(
            self.token_program_y.key() == *self.mint_y.to_account_info().owner,
            AmmError::InvalidTokenProgram
        );

        // Verify token programs are valid (Token or Token 2022)
        let valid_programs = [
            anchor_spl::token::ID,           // Original Token program
            anchor_spl::token_interface::spl_token_2022::ID,      // Token 2022 program
        ];

        require!(
            valid_programs.contains(&self.token_program_x.key()),
            AmmError::InvalidTokenProgram
        );

        require!(
            valid_programs.contains(&self.token_program_y.key()),
            AmmError::InvalidTokenProgram
        );

        Ok(())
    }

    fn validate_token_extensions(&self) -> Result<()> {
        // Check for unsupported extensions on mint_x
        self.check_unsupported_extensions(&self.mint_x, "mint_x")?;
        
        // Check for unsupported extensions on mint_y
        self.check_unsupported_extensions(&self.mint_y, "mint_y")?;

        Ok(())
    }

    fn check_unsupported_extensions(&self, mint: &InterfaceAccount<Mint>, mint_name: &str) -> Result<()> {
        let mint_info = mint.to_account_info();
        
        // Only check extensions for Token 2022 mints
        if mint_info.owner != &anchor_spl::token_interface::spl_token_2022::ID {
            return Ok(());
        }

        let mint_data = mint_info.try_borrow_data()?;
        
        use anchor_spl::token_interface::spl_token_2022::extension::{StateWithExtensions, ExtensionType, BaseStateWithExtensions, default_account_state::DefaultAccountState};
        use anchor_spl::token_interface::spl_token_2022::state::AccountState;
        
        if let Ok(mint_with_extension) = StateWithExtensions::<anchor_spl::token_interface::spl_token_2022::state::Mint>::unpack(&mint_data) {
            let extension_types = mint_with_extension.get_extension_types()?;
            
            for extension_type in extension_types {
                match extension_type {
                    // Supported extensions
                    ExtensionType::TransferFeeConfig => {
                        msg!("{} has transfer fee extension - supported", mint_name);
                    }
                    ExtensionType::TransferHook => {
                        msg!("{} has transfer hook extension - supported", mint_name);
                    }
                    ExtensionType::MintCloseAuthority => {
                        msg!("{} has mint close authority - supported", mint_name);
                    }
                    ExtensionType::PermanentDelegate => {
                        msg!("{} has permanent delegate - supported", mint_name);
                    }
                    
                    // Potentially problematic extensions
                    ExtensionType::NonTransferable => {
                        msg!("WARNING: {} has non-transferable extension", mint_name);
                        return Err(AmmError::UnsupportedExtension.into());
                    }
                    ExtensionType::DefaultAccountState => {
                        // Check if accounts are frozen by default
                        if let Ok(default_state) = mint_with_extension.get_extension::<DefaultAccountState>() {
                            if default_state.state == u8::from(AccountState::Frozen) {
                                msg!("WARNING: {} has default frozen state", mint_name);
                                return Err(AmmError::UnsupportedExtension.into());
                            }
                        }
                    }
                    
                    // Other extensions - warn but allow
                    _ => {
                        msg!("INFO: {} has extension {:?} - proceeding with caution", mint_name, extension_type);
                    }
                }
            }
        }

        Ok(())
    }

    fn has_transfer_fee(&self, mint: &InterfaceAccount<Mint>) -> Result<bool> {
        let mint_info = mint.to_account_info();
        
        if mint_info.owner != &anchor_spl::token_interface::spl_token_2022::ID {
            return Ok(false);
        }

        let mint_data = mint_info.try_borrow_data()?;
        
        use anchor_spl::token_interface::spl_token_2022::extension::{BaseStateWithExtensions, StateWithExtensions, transfer_fee::TransferFeeConfig};
        
        if let Ok(mint_with_extension) = StateWithExtensions::<anchor_spl::token_interface::spl_token_2022::state::Mint>::unpack(&mint_data) {
            return Ok(mint_with_extension.get_extension::<TransferFeeConfig>().is_ok());
        }
        
        Ok(false)
    }

    fn has_transfer_hook(&self, mint: &InterfaceAccount<Mint>) -> Result<Option<Pubkey>> {
        let mint_info = mint.to_account_info();
        
        if mint_info.owner != &anchor_spl::token_interface::spl_token_2022::ID {
            return Ok(None);
        }

        let mint_data = mint_info.try_borrow_data()?;
        
        use anchor_spl::token_interface::spl_token_2022::extension::{BaseStateWithExtensions, StateWithExtensions, transfer_hook::TransferHook};
        
        if let Ok(mint_with_extension) = StateWithExtensions::<anchor_spl::token_interface::spl_token_2022::state::Mint>::unpack(&mint_data) {
            if let Ok(transfer_hook) = mint_with_extension.get_extension::<TransferHook>() {
                return Ok(Some(Pubkey::try_from(transfer_hook.program_id.0.as_ref()).unwrap_or_default()));
            }
        }
        
        Ok(None)
    }
}
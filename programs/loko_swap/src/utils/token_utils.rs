use anchor_lang::prelude::*;
use anchor_spl::token_interface::spl_token_2022::{
    extension::{
        BaseStateWithExtensions, StateWithExtensions, 
        transfer_fee::TransferFeeConfig, transfer_hook::TransferHook
    },
    state::Mint,
    onchain::invoke_transfer_checked,
};
use crate::error::AmmError;

/// Check if a mint has the transfer fee extension
pub fn has_transfer_fee_extension(mint_account: &AccountInfo) -> Result<bool> {
    let mint_data = mint_account.try_borrow_data()?;
    
    // Only check Token-2022 mints
    if mint_account.owner != &anchor_spl::token_interface::spl_token_2022::ID {
        return Ok(false);
    }
    
    let mint_state = StateWithExtensions::<Mint>::unpack(&mint_data)?;
    Ok(mint_state.get_extension::<TransferFeeConfig>().is_ok())
}

/// Check if a mint has the transfer hook extension
pub fn has_transfer_hook_extension(mint_account: &AccountInfo) -> Result<bool> {
    let mint_data = mint_account.try_borrow_data()?;
    
    // Only check Token-2022 mints
    if mint_account.owner != &anchor_spl::token_interface::spl_token_2022::ID {
        return Ok(false);
    }
    
    let mint_state = StateWithExtensions::<Mint>::unpack(&mint_data)?;
    Ok(mint_state.get_extension::<TransferHook>().is_ok())
}

/// Get the transfer fee configuration from a mint
pub fn get_transfer_fee_config(mint_account: &AccountInfo) -> Result<TransferFeeConfig> {
    let mint_data = mint_account.try_borrow_data()?;
    let mint_state = StateWithExtensions::<Mint>::unpack(&mint_data)?;
    
    mint_state.get_extension::<TransferFeeConfig>()
        .map(|config| *config)
        .map_err(|_| error!(AmmError::TransferFeeNotFound))
}

/// Get the transfer hook program ID from a mint
pub fn get_transfer_hook_program_id(mint_account: &AccountInfo) -> Result<Pubkey> {
    let mint_data = mint_account.try_borrow_data()?;
    let mint_state = StateWithExtensions::<Mint>::unpack(&mint_data)?;
    
    let transfer_hook = mint_state.get_extension::<TransferHook>()
        .map_err(|_| error!(AmmError::TransferHookNotFound))?;
    
    Ok(Pubkey::try_from(transfer_hook.program_id.0.as_ref()).unwrap_or_default())
}

/// Calculate the transfer fee for a given amount
pub fn calculate_transfer_fee(amount: u64, fee_config: &TransferFeeConfig) -> u64 {
    // Use the newer transfer fee configuration
    let fee_basis_points = u16::from(fee_config.newer_transfer_fee.transfer_fee_basis_points);
    let maximum_fee = u64::from(fee_config.newer_transfer_fee.maximum_fee);
    
    let fee = (amount as u128)
        .checked_mul(fee_basis_points as u128)
        .unwrap()
        .checked_div(10_000)
        .unwrap() as u64;
    
    std::cmp::min(fee, maximum_fee)
}

/// Calculate the gross amount needed to achieve a net amount after fees
/// Formula: gross = net / (1 - fee_rate)
pub fn calculate_gross_amount(net_amount: u64, fee_config: &TransferFeeConfig) -> u64 {
    let fee_rate = u16::from(fee_config.newer_transfer_fee.transfer_fee_basis_points) as u128;
    
    if fee_rate == 0 {
        return net_amount;
    }
    
    let gross = (net_amount as u128)
        .checked_mul(10_000)
        .unwrap()
        .checked_div(10_000 - fee_rate)
        .unwrap() as u64;
    
    gross
}

/// Calculate the net amount that will be received after fees are deducted
pub fn calculate_net_amount(gross_amount: u64, fee_config: &TransferFeeConfig) -> u64 {
    let fee = calculate_transfer_fee(gross_amount, fee_config);
    gross_amount.saturating_sub(fee)
}

/// Check if a mint is a Token-2022 mint
pub fn is_token_2022_mint(mint_account: &AccountInfo) -> bool {
    mint_account.owner == &anchor_spl::token_interface::spl_token_2022::ID
}

/// Check if a mint is a legacy Token mint
pub fn is_legacy_token_mint(mint_account: &AccountInfo) -> bool {
    mint_account.owner == &anchor_spl::token::ID
}

/// Comprehensive extension check - optimized struct with minimal data
#[derive(Debug, Clone)]
pub struct TokenExtensions {
    pub has_transfer_fee: bool,
    pub has_transfer_hook: bool,
    pub transfer_hook_program_id: Option<Pubkey>,
    // Store only the values we need instead of full config
    pub transfer_fee_basis_points: u16,
    pub transfer_fee_maximum: u64,
}

impl TokenExtensions {
    pub fn new(mint_account: &AccountInfo) -> Result<Box<Self>> {
        let extensions = Self::create_extensions(mint_account)?;
        Ok(Box::new(extensions))
    }
    
    fn create_extensions(mint_account: &AccountInfo) -> Result<Self> {
        if !is_token_2022_mint(mint_account) {
            return Ok(Self {
                has_transfer_fee: false,
                has_transfer_hook: false,
                transfer_hook_program_id: None,
                transfer_fee_basis_points: 0,
                transfer_fee_maximum: 0,
            });
        }

        let has_transfer_fee = has_transfer_fee_extension(mint_account)?;
        let has_transfer_hook = has_transfer_hook_extension(mint_account)?;
        
        let (transfer_fee_basis_points, transfer_fee_maximum) = if has_transfer_fee {
            let config = get_transfer_fee_config(mint_account)?;
            (
                u16::from(config.newer_transfer_fee.transfer_fee_basis_points),
                u64::from(config.newer_transfer_fee.maximum_fee)
            )
        } else {
            (0, 0)
        };
        
        let transfer_hook_program_id = if has_transfer_hook {
            Some(get_transfer_hook_program_id(mint_account)?)
        } else {
            None
        };

        Ok(Self {
            has_transfer_fee,
            has_transfer_hook,
            transfer_hook_program_id,
            transfer_fee_basis_points,
            transfer_fee_maximum,
        })
    }
    
    /// Calculate fee for this token if it has transfer fee extension
    pub fn calculate_fee(&self, amount: u64) -> u64 {
        if self.has_transfer_fee {
            let fee = (amount as u128)
                .checked_mul(self.transfer_fee_basis_points as u128)
                .unwrap()
                .checked_div(10_000)
                .unwrap() as u64;
            std::cmp::min(fee, self.transfer_fee_maximum)
        } else {
            0
        }
    }
    
    /// Calculate gross amount needed to get net amount for this token
    pub fn calculate_gross_for_net(&self, net_amount: u64) -> u64 {
        if self.has_transfer_fee && self.transfer_fee_basis_points > 0 {
            let fee_rate = self.transfer_fee_basis_points as u128;
            (net_amount as u128)
                .checked_mul(10_000)
                .unwrap()
                .checked_div(10_000 - fee_rate)
                .unwrap() as u64
        } else {
            net_amount
        }
    }
    
    /// Lightweight check for transfer fee without creating full extension struct
    pub fn has_fee_only(mint_account: &AccountInfo) -> Result<bool> {
        if !is_token_2022_mint(mint_account) {
            return Ok(false);
        }
        has_transfer_fee_extension(mint_account)
    }
    
    /// Lightweight check for transfer hook without creating full extension struct
    pub fn has_hook_only(mint_account: &AccountInfo) -> Result<bool> {
        if !is_token_2022_mint(mint_account) {
            return Ok(false);
        }
        has_transfer_hook_extension(mint_account)
    }
}

/// Direct fee calculation without struct allocation - optimized for stack usage
pub fn calculate_fee_direct(mint_account: &AccountInfo, amount: u64) -> Result<u64> {
    if !is_token_2022_mint(mint_account) || !has_transfer_fee_extension(mint_account)? {
        return Ok(0);
    }
    
    let config = get_transfer_fee_config(mint_account)?;
    let fee_basis_points = u16::from(config.newer_transfer_fee.transfer_fee_basis_points);
    let maximum_fee = u64::from(config.newer_transfer_fee.maximum_fee);
    
    let fee = (amount as u128)
        .checked_mul(fee_basis_points as u128)
        .unwrap()
        .checked_div(10_000)
        .unwrap() as u64;
    
    Ok(std::cmp::min(fee, maximum_fee))
}

/// Direct gross amount calculation without struct allocation - optimized for stack usage
pub fn calculate_gross_for_net_direct(mint_account: &AccountInfo, net_amount: u64) -> Result<u64> {
    if !is_token_2022_mint(mint_account) || !has_transfer_fee_extension(mint_account)? {
        return Ok(net_amount);
    }
    
    let config = get_transfer_fee_config(mint_account)?;
    let fee_basis_points = u16::from(config.newer_transfer_fee.transfer_fee_basis_points);
    
    if fee_basis_points == 0 {
        return Ok(net_amount);
    }
    
    let fee_rate = fee_basis_points as u128;
    let gross = (net_amount as u128)
        .checked_mul(10_000)
        .unwrap()
        .checked_div(10_000 - fee_rate)
        .unwrap() as u64;
    
    Ok(gross)
}

/// Direct Token-2022 transfer with hook support
pub fn invoke_transfer_checked_with_hooks<'info>(
    token_program_key: &Pubkey,
    source: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
    amount: u64,
    decimals: u8,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    msg!("Using direct spl_token_2022::onchain::invoke_transfer_checked with hook support");
    
    invoke_transfer_checked(
        token_program_key,
        source,
        mint,
        destination,
        authority,
        remaining_accounts,
        amount,
        decimals,
        signer_seeds,
    ).map_err(move |e| {
        msg!("Direct Token-2022 transfer with hooks failed: {:?}", e);
        anchor_lang::error::Error::from(e)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_transfer_fee() {
        let fee_config = TransferFeeConfig {
            transfer_fee_config_authority: Default::default(),
            withdraw_withheld_authority: Default::default(),
            withheld_amount: 0.into(),
            older_transfer_fee: Default::default(),
            newer_transfer_fee: anchor_spl::token_interface::spl_token_2022::extension::transfer_fee::TransferFee {
                epoch: 0.into(),
                transfer_fee_basis_points: 50.into(), // 0.5%
                maximum_fee: 1000.into(),
            },
        };
        
        // Test normal case
        assert_eq!(calculate_transfer_fee(10000, &fee_config), 5); // 0.5% of 10000
        
        // Test maximum fee cap
        assert_eq!(calculate_transfer_fee(1000000, &fee_config), 1000); // Capped at max
    }
    
    #[test]
    fn test_calculate_gross_amount() {
        let fee_config = TransferFeeConfig {
            transfer_fee_config_authority: Default::default(),
            withdraw_withheld_authority: Default::default(),
            withheld_amount: 0.into(),
            older_transfer_fee: Default::default(),
            newer_transfer_fee: anchor_spl::token_interface::spl_token_2022::extension::transfer_fee::TransferFee {
                epoch: 0.into(),
                transfer_fee_basis_points: 50.into(), // 0.5%
                maximum_fee: u64::MAX.into(),
            },
        };
        
        // Test: to get 9950 net, need ~10000 gross (with 0.5% fee)
        let gross = calculate_gross_amount(9950, &fee_config);
        let fee = calculate_transfer_fee(gross, &fee_config);
        let net = gross - fee;
        
        assert!(net >= 9950);
        assert!(net <= 9951); // Allow for rounding
    }
}
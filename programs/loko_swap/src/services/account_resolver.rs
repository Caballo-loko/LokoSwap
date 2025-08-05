use anchor_lang::prelude::*;
use anchor_spl::token_interface::spl_token_2022::{
    extension::{BaseStateWithExtensions, StateWithExtensions, transfer_hook::TransferHook},
    state::Mint,
};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    // seeds::Seed,
    // state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::{
    get_extra_account_metas_address,
    // instruction::ExecuteInstruction,
};
use crate::error::AmmError;

/// Resolve additional accounts needed for transfer hook execution
/// This function parses the TLV data from a Token-2022 mint to get hook accounts
pub fn resolve_transfer_hook_accounts(
    mint_account: &AccountInfo,
    source_account: &AccountInfo,
    mint: &AccountInfo,
    destination_account: &AccountInfo,
    authority: &AccountInfo,
    _amount: u64,
) -> Result<Vec<AccountMeta>> {
    // First, verify this mint has a transfer hook extension
    let mint_data = mint_account.try_borrow_data()?;
    let mint_state = StateWithExtensions::<Mint>::unpack(&mint_data)
        .map_err(|_| error!(AmmError::InvalidToken))?;
    
    let transfer_hook = mint_state.get_extension::<TransferHook>()
        .map_err(|_| error!(AmmError::TransferHookNotFound))?;
    
    let hook_program_id = Pubkey::try_from(transfer_hook.program_id.0.as_ref()).unwrap_or_default();
    if hook_program_id == Pubkey::default() {
        return Err(error!(AmmError::TransferHookNotFound));
    }
    
    // Get the extra account metas address for this mint
    let extra_metas_address = get_extra_account_metas_address(mint_account.key, &hook_program_id);
    
    // The hook accounts should be provided by the client via remaining_accounts
    // This function helps validate and structure them properly
    
    // Create the basic transfer hook accounts
    let hook_accounts = vec![
        AccountMeta::new_readonly(*source_account.key, false),
        AccountMeta::new_readonly(*mint.key, false),
        AccountMeta::new_readonly(*destination_account.key, false),
        AccountMeta::new_readonly(*authority.key, false),
        AccountMeta::new_readonly(extra_metas_address, false),
        AccountMeta::new_readonly(hook_program_id, false),
    ];
    
    Ok(hook_accounts)
}

/// Parse extra account metas from TLV data
/// This is used when the client provides remaining_accounts for hook execution
pub fn parse_extra_account_metas(
    extra_metas_account: &AccountInfo,
) -> Result<Vec<ExtraAccountMeta>> {
    if extra_metas_account.data_is_empty() {
        return Ok(vec![]);
    }
    
    let _data = extra_metas_account.try_borrow_data()?;
    // Parse the TLV data to extract extra account metas
    // For now, return empty vec since parsing is complex
    Ok(vec![])
}

/// Resolve accounts for a transfer hook execution
/// This combines the basic transfer accounts with any extra accounts from TLV data
pub fn resolve_hook_execution_accounts(
    mint_account: &AccountInfo,
    source_account: &AccountInfo,
    destination_account: &AccountInfo,
    authority: &AccountInfo,
    extra_metas_account: Option<&AccountInfo>,
) -> Result<Vec<AccountMeta>> {
    let accounts = vec![
        AccountMeta::new(*source_account.key, false),
        AccountMeta::new_readonly(*mint_account.key, false),
        AccountMeta::new(*destination_account.key, false),
        AccountMeta::new_readonly(*authority.key, true),
    ];
    
    // Add extra accounts if provided
    if let Some(extra_account) = extra_metas_account {
        let extra_metas = parse_extra_account_metas(extra_account)?;
        
        for extra_meta in extra_metas {
            match extra_meta {
                // Pattern matching will be implemented once the exact ExtraAccountMeta structure is determined
                _ => {
                    msg!("Extra account meta found - handling not yet implemented");
                }
            }
        }
    }
    
    Ok(accounts)
}

/// Check if an account is a Token-2022 account with extensions
pub fn is_token_2022_account(account: &AccountInfo) -> bool {
    account.owner == &anchor_spl::token_interface::spl_token_2022::ID
}

/// Get the extension types present in a Token-2022 mint
pub fn get_mint_extension_types(mint_account: &AccountInfo) -> Result<Vec<u16>> {
    if !is_token_2022_account(mint_account) {
        return Ok(vec![]);
    }
    
    let mint_data = mint_account.try_borrow_data()?;
    let mint_state = StateWithExtensions::<Mint>::unpack(&mint_data)
        .map_err(|_| error!(AmmError::InvalidToken))?;
    
    let extension_types = mint_state.get_extension_types()
        .map_err(|_| error!(AmmError::InvalidToken))?;
    
    Ok(extension_types.iter().map(|et| (*et) as u16).collect())
}

/// Validate that all required accounts for transfer hook execution are present
pub fn validate_hook_accounts(
    hook_program_id: &Pubkey,
    provided_accounts: &[AccountInfo],
    required_count: usize,
) -> Result<()> {
    require!(
        provided_accounts.len() >= required_count,
        AmmError::InvalidToken
    );
    
    // Validate that the hook program is present
    let hook_program_present = provided_accounts
        .iter()
        .any(|account| account.key == hook_program_id);
    
    require!(hook_program_present, AmmError::TransferHookNotFound);
    
    Ok(())
}

/// Helper to create AccountMeta for transfer hook CPIs
pub fn create_hook_account_metas(
    source: &Pubkey,
    mint: &Pubkey,
    destination: &Pubkey,
    authority: &Pubkey,
    hook_program: &Pubkey,
    extra_accounts: &[AccountMeta],
) -> Vec<AccountMeta> {
    let mut accounts = vec![
        AccountMeta::new(*source, false),
        AccountMeta::new_readonly(*mint, false),
        AccountMeta::new(*destination, false),
        AccountMeta::new_readonly(*authority, true),
        AccountMeta::new_readonly(*hook_program, false),
    ];
    
    accounts.extend_from_slice(extra_accounts);
    accounts
}

/// TLV account resolution utilities for safe parsing of extension data
pub mod tlv_utils {
    use super::*;
    // use spl_tlv_account_resolution::state::Account as TlvAccount;
    
    // Removed unpack_mint_account to avoid lifetime issues - use direct unpacking instead
    
    /// Parse TLV account data generically
    // pub fn parse_tlv_account<T>(account: &AccountInfo) -> Result<TlvAccount<T>> 
    // where
    //     T: anchor_lang::ZeroCopy + anchor_lang::Owner,
    // {
    //     let data = account.try_borrow_data()?;
    //     TlvAccount::<T>::unpack(&data)
    //         .map_err(|_| error!(AmmError::InvalidToken))
    // }
    
    /// Check if account has enough space for TLV data
    pub fn validate_tlv_account_size(account: &AccountInfo, minimum_size: usize) -> Result<()> {
        require!(
            account.data_len() >= minimum_size,
            AmmError::InvalidToken
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_create_hook_account_metas() {
        let source = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let destination = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let hook_program = Pubkey::new_unique();
        let extra_accounts = vec![];
        
        let metas = create_hook_account_metas(
            &source,
            &mint,
            &destination,
            &authority,
            &hook_program,
            &extra_accounts,
        );
        
        assert_eq!(metas.len(), 5);
        assert_eq!(metas[0].pubkey, source);
        assert_eq!(metas[1].pubkey, mint);
        assert_eq!(metas[2].pubkey, destination);
        assert_eq!(metas[3].pubkey, authority);
        assert_eq!(metas[4].pubkey, hook_program);
    }
}
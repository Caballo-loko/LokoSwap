use std::{ cell::RefMut, str::FromStr };
use anchor_lang::{ prelude::*, solana_program::{pubkey::Pubkey, program_error::ProgramError, clock::Clock, sysvar::Sysvar} };
use anchor_spl::{
    associated_token::AssociatedToken,
    token::Token,
    token_2022::spl_token_2022::{
        extension::{
            transfer_hook::TransferHookAccount,
            BaseStateWithExtensionsMut,
            PodStateWithExtensionsMut,
        },
        pod::PodAccount,
    },
    token_interface::{ Mint, TokenAccount },
};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    seeds::Seed,
    state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::{
    instruction::{ExecuteInstruction, TransferHookInstruction},
};

//  DYNAMIC FEE SCALING TRANSFER HOOK
// Implements velocity-based fee adjustment for AMM congestion control
// Fee scaling: 0.1% → 0.2% → 0.5% → 1.2% → 3.0% based on transaction velocity
declare_id!("69VddXVhzGRGh3oU6eKoWEoNMJC8RJX6by1SgcuQfPR9");

#[error_code]
pub enum DynamicFeeError {
    #[msg("Math overflow in calculations")]
    MathOverflow,
    #[msg("The token is not currently transferring")]
    InvalidTransferState,
    #[msg("Fee calculation failed")]
    FeeCalculationFailed,
    #[msg("Time window update failed")]
    TimeWindowUpdateFailed,
}

#[program]
pub mod dynamic_fee_hook {
    use super::*;

    #[interface(spl_transfer_hook_interface::initialize_extra_account_meta_list)]
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>
    ) -> Result<()> {
        let extra_account_metas = InitializeExtraAccountMetaList::extra_account_metas()?;

        // Initialize ExtraAccountMetaList account with required accounts
        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            &extra_account_metas
        )?;

        msg!("Dynamic fee hook initialized");
        Ok(())
    }

    #[interface(spl_transfer_hook_interface::execute)]
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        // Validate this is called within a transfer hook context
        check_transfer_state(&ctx)?;

        let fee_stats = &mut ctx.accounts.fee_stats;
        
        // Initialize fee stats on first use
        if fee_stats.total_transfers == 0 {
            fee_stats.base_fee_basis_points = 10;  // 0.1%
            fee_stats.current_fee_basis_points = 10;
            fee_stats.max_fee_basis_points = 300;  // 3.0%
            fee_stats.last_update_timestamp = Clock::get()?.unix_timestamp;
            msg!("Fee stats initialized: base={}bp, max={}bp", 
                 fee_stats.base_fee_basis_points, fee_stats.max_fee_basis_points);
        }

        // Update velocity tracking and calculate dynamic fee
        let current_timestamp = Clock::get()?.unix_timestamp;
        let current_fee = update_velocity_and_calculate_fee(fee_stats, current_timestamp, amount)?;
        
        // Update totals with proper error handling
        fee_stats.total_transfers = fee_stats.total_transfers
            .checked_add(1)
            .ok_or(DynamicFeeError::MathOverflow)?;
        fee_stats.total_volume = fee_stats.total_volume
            .checked_add(amount)
            .ok_or(DynamicFeeError::MathOverflow)?;

        msg!("Transfer #{}: amount={}, fee={}bp", 
             fee_stats.total_transfers, amount, current_fee);

        Ok(())
    }

    /// Fallback function to handle transfer hook interface
    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        let instruction = TransferHookInstruction::unpack(data)?;
        
        match instruction {
            TransferHookInstruction::Execute { amount } => {
                let amount_bytes = amount.to_le_bytes();
                __private::__global::transfer_hook(program_id, accounts, &amount_bytes)
            }
            _ => Err(ProgramError::InvalidInstructionData.into()),
        }
    }
}

/// Validates that this hook is called within a proper transfer context
fn check_transfer_state(ctx: &Context<TransferHook>) -> Result<()> {
    let source_token_info = ctx.accounts.source_token.to_account_info();
    let mut account_data_ref: RefMut<&mut [u8]> = source_token_info.try_borrow_mut_data()?;
    let mut account = PodStateWithExtensionsMut::<PodAccount>::unpack(*account_data_ref)?;
    let account_extension = account.get_extension_mut::<TransferHookAccount>()?;

    if !bool::from(account_extension.transferring) {
        return err!(DynamicFeeError::InvalidTransferState);
    }

    Ok(())
}

/// Dynamic fee scaling based on transaction velocity
/// TPM thresholds: 10->20bp, 30->50bp, 60->120bp, 120->300bp
fn update_velocity_and_calculate_fee(
    fee_stats: &mut DynamicFeeStats,
    current_timestamp: i64,
    amount: u64,
) -> Result<u16> {
    let time_diff = current_timestamp - fee_stats.last_update_timestamp;
    
    if time_diff >= 60 {
        let windows_to_advance = std::cmp::min(6, (time_diff / 60) as usize);
        
        for _ in 0..windows_to_advance {
            fee_stats.current_minute_slot = (fee_stats.current_minute_slot + 1) % 6;
            let slot = fee_stats.current_minute_slot as usize;
            fee_stats.recent_transfers[slot] = 0;
            fee_stats.recent_volumes[slot] = 0;
        }
        
        fee_stats.last_update_timestamp = current_timestamp;
    }
    let current_slot = fee_stats.current_minute_slot as usize;
    fee_stats.recent_transfers[current_slot] = fee_stats.recent_transfers[current_slot]
        .checked_add(1)
        .ok_or(DynamicFeeError::MathOverflow)?;
    fee_stats.recent_volumes[current_slot] = fee_stats.recent_volumes[current_slot]
        .checked_add(amount)
        .ok_or(DynamicFeeError::MathOverflow)?;
    
    let total_tpm = fee_stats.recent_transfers.iter().sum::<u64>();
    if fee_stats.total_transfers > 0 {
        fee_stats.avg_transfer_size = (fee_stats.avg_transfer_size
            .checked_mul(fee_stats.total_transfers)
            .and_then(|v| v.checked_add(amount))
            .and_then(|v| v.checked_div(fee_stats.total_transfers + 1)))
            .ok_or(DynamicFeeError::MathOverflow)?;
    } else {
        fee_stats.avg_transfer_size = amount;
    }
    
    let base_fee = if total_tpm <= 10 {
        fee_stats.base_fee_basis_points
    } else if total_tpm <= 30 {
        fee_stats.base_fee_basis_points * 2
    } else if total_tpm <= 60 {
        fee_stats.base_fee_basis_points * 5
    } else if total_tpm <= 120 {
        fee_stats.base_fee_basis_points * 12
    } else {
        fee_stats.max_fee_basis_points
    };
    
    let fee_change_limit = fee_stats.base_fee_basis_points;
    let smoothed_fee = if base_fee > fee_stats.current_fee_basis_points {
        std::cmp::min(base_fee, fee_stats.current_fee_basis_points + fee_change_limit)
    } else {
        std::cmp::max(base_fee, fee_stats.current_fee_basis_points.saturating_sub(fee_change_limit))
    };
    
    let current_tps = (total_tpm as f64 / 60.0) as u16;
    if current_tps > fee_stats.peak_tps {
        fee_stats.peak_tps = current_tps;
    }
    
    fee_stats.current_fee_basis_points = std::cmp::min(smoothed_fee, fee_stats.max_fee_basis_points);
    if fee_stats.avg_transfer_size > 0 && amount > fee_stats.avg_transfer_size * 10 {
        fee_stats.current_fee_basis_points = std::cmp::min(
            (fee_stats.current_fee_basis_points as f64 * 1.5) as u16,
            fee_stats.max_fee_basis_points
        );
    }
    
    Ok(fee_stats.current_fee_basis_points)
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// CHECK: ExtraAccountMetaList Account, must use these seeds
    #[account(
        init,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
        space = ExtraAccountMetaList::size_of(
            InitializeExtraAccountMetaList::extra_account_metas()?.len()
        )?,
        payer = payer
    )]
    pub extra_account_meta_list: AccountInfo<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init_if_needed, seeds = [b"fee_stats"], bump, payer = payer, space = 8 + 200)]
    pub fee_stats: Account<'info, DynamicFeeStats>,
    pub system_program: Program<'info, System>,
}

impl<'info> InitializeExtraAccountMetaList<'info> {
    pub fn extra_account_metas() -> Result<Vec<ExtraAccountMeta>> {
        Ok(vec![
            ExtraAccountMeta::new_with_pubkey(
                &Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap(),
                false, false
            )?,
            ExtraAccountMeta::new_with_pubkey(&Token::id(), false, false)?,
            ExtraAccountMeta::new_with_pubkey(&AssociatedToken::id(), false, false)?,
            ExtraAccountMeta::new_with_seeds(
                &[Seed::Literal { bytes: b"delegate".to_vec() }],
                false, true
            )?,
            ExtraAccountMeta::new_external_pda_with_seeds(
                7, &[
                    Seed::AccountKey { index: 8 },
                    Seed::AccountKey { index: 6 },
                    Seed::AccountKey { index: 5 },
                ],
                false, true
            )?,
            ExtraAccountMeta::new_external_pda_with_seeds(
                7, &[
                    Seed::AccountKey { index: 3 },
                    Seed::AccountKey { index: 6 },
                    Seed::AccountKey { index: 5 },
                ],
                false, true
            )?,
            ExtraAccountMeta::new_with_seeds(
                &[Seed::Literal { bytes: b"fee_stats".to_vec() }],
                false, true
            )?
        ])
    }
}

#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(token::mint = mint, token::authority = owner)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: source token account owner
    pub owner: UncheckedAccount<'info>,
    /// CHECK: ExtraAccountMetaList Account
    #[account(seeds = [b"extra-account-metas", mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    pub wsol_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    #[account(mut, seeds = [b"delegate"], bump)]
    pub delegate: SystemAccount<'info>,
    #[account(mut, token::mint = wsol_mint, token::authority = delegate)]
    pub delegate_wsol_token_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: WSOL token account
    #[account(mut, token::mint = wsol_mint)]
    pub sender_wsol_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, seeds = [b"fee_stats"], bump)]
    pub fee_stats: Account<'info, DynamicFeeStats>,
}

#[account]
pub struct DynamicFeeStats {
    pub total_fees_collected: u64,
    pub total_transfers: u64,
    pub total_volume: u64,
    pub current_fee_basis_points: u16,
    pub base_fee_basis_points: u16,
    pub max_fee_basis_points: u16,
    pub recent_transfers: [u64; 6],
    pub recent_volumes: [u64; 6],
    pub current_minute_slot: u8,
    pub last_update_timestamp: i64,
    pub peak_tps: u16,
    pub avg_transfer_size: u64,
}